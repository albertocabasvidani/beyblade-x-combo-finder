/**
 * wbo-parse.ts — Parser WBO 100% DETERMINISTICO (nessuna IA, nessuna API a pagamento).
 *
 * Fa tutto a codice: segmentazione del thread (evento → podio → righe-combo) via regex, risoluzione
 * parti/sigle ufficiali, parsing eventId/data/players, accumulo combo (id-set), dedup e stats. Lo
 * schema di output replica parse-metabeys.ts: { combos, unresolved, stats }. I casi che la
 * segmentazione non risolve (eventi-ladder, layout insoliti) restano in `unresolved`: li rifinisce
 * l'IA in /update-combos, che gira sull'abbonamento Claude Code (NON via API Anthropic).
 *
 * Funzioni pure ed esportate (niente I/O di pipeline qui) per essere testabili nel golden test.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { PlacementEvidence, UsageEvidence, BladeType } from '../../src/lib/types';
import { isFresh } from './freshness';
import { buildCxResolver, resolveCxBladePart, cxComboId, cxDisplayName, type CxResolver } from './cx-resolve';

const ROOT = join(import.meta.dirname, '..', '..');
const partsPath = join(ROOT, 'data', 'parts.json');

/** id della fonte in sources.json (usato in PlacementEvidence.source). */
export const SOURCE_ID = 'wbo-winning-combos';

export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
/**
 * squash: per matchare i token incollati del WBO ("WizardRod", "Hover Wyvern") contro i nomi del
 * registro ("Wizard Rod"). Rimuove spazi E trattini. Applicato al lato blade/bit della riga, dopo
 * che il ratchet è già stato staccato.
 */
export const squash = (s: string) => norm(s).replace(/[\s-]+/g, '');

const RATCHET_RE = /\d-\d{2}/;        // tokenizzazione combo + guard "landmine"
const STAGE_RE = /\s*\([^)]*\)\s*$/;  // " (First Stage & Final Stage)", " (Both Stages)", ...

// ---- Resolver -------------------------------------------------------------

interface BladeRef { id: string; name: string; type: BladeType; integratedRatchet?: boolean }
interface BitRef { id: string; name: string }
export interface Resolver {
  blade: Map<string, BladeRef>;
  bit: Map<string, BitRef>;        // per nome/alias (chiave squash)
  bitByCode: Map<string, BitRef>;  // per codice ufficiale (chiave uppercase, es. "H", "FB", "LR")
  ratchet: Set<string>;
  cx: CxResolver;                  // risolutore del lato sinistro CX (lockChip+mainBlade+assist[+over])
}

/**
 * Costruisce il resolver da parts.json (lo schema consumato; deriva dal master via build:parts).
 * Indicizza blade per name+nameWestern+aliases e bit per name+aliases (squash), più i codici
 * ufficiali (shortName). GUARD: non indicizza alcun nome/alias il cui squash incorpora un ratchet
 * (es. nameWestern "Impact Drake 9-60LR"), che altrimenti inquinerebbe il match.
 */
export function buildResolver(partsArg?: any): Resolver {
  const parts = partsArg ?? JSON.parse(readFileSync(partsPath, 'utf8'));
  const blade = new Map<string, BladeRef>();
  const bit = new Map<string, BitRef>();
  const bitByCode = new Map<string, BitRef>();

  const addKey = <T>(map: Map<string, T>, key: string, v: T) => {
    const k = squash(key);
    if (!k || RATCHET_RE.test(k)) return;   // scarta le forme che incorporano un ratchet
    if (!map.has(k)) map.set(k, v);
  };
  // HARDENING: i nomi Hasbro/occidentali inglobano spesso ratchet+bit (es. "Rock Golem 1-60UN",
  // "Spear Scorpio 0-70Z"); addKey li scarterebbe per la guard sul ratchet, e la forma nuda
  // ("Rock Golem") non verrebbe mai indicizzata. Qui strippiamo il suffisso ratchet+resto e
  // indicizziamo anche il nome nudo, così le forme Western invertite risolvono.
  const stripRatchetSuffix = (s: string) => s.replace(/\s*\d-\d{2}.*$/, '').trim();
  const addBlade = (key: string | undefined, v: BladeRef) => {
    if (!key) return;
    addKey(blade, key, v);
    addKey(blade, stripRatchetSuffix(key), v);
  };

  for (const b of parts.blades ?? []) {
    const v: BladeRef = { id: b.id, name: b.name, type: b.type as BladeType, ...(b.integratedRatchet ? { integratedRatchet: true } : {}) };
    addKey(blade, b.name, v);
    addBlade(b.nameWestern, v);
    for (const a of b.aliases ?? []) addBlade(a, v);
  }
  for (const b of parts.bits ?? []) {
    const v: BitRef = { id: b.id, name: b.name };
    addKey(bit, b.name, v);
    if (b.nameWestern) addKey(bit, b.nameWestern, v);
    for (const a of b.aliases ?? []) addKey(bit, a, v);
    if (b.shortName) {
      const code = String(b.shortName).toUpperCase();
      if (!bitByCode.has(code)) bitByCode.set(code, v);
    }
  }
  const ratchet = new Set<string>((parts.ratchets ?? []).map((r: any) => r.id));
  return { blade, bit, bitByCode, ratchet, cx: buildCxResolver(parts) };
}

// ---- Risoluzione di una riga combo ---------------------------------------

export interface ResolvedCombo {
  id: string; line: 'bx' | 'cx';
  blade: string | null; ratchet: string; bit: string;
  lockChip?: string | null; mainBlade?: string | null; assistBlade?: string | null; overBlade?: string | null;
  displayName: string; type: BladeType;
}
export type ComboLineResult = { ok: true; combo: ResolvedCombo } | { ok: false; reason: string };

/** Risolve un bit per nome/alias (squash) o sigla ufficiale (uppercase). */
function resolveBit(r: Resolver, bitPart: string) {
  return r.bit.get(squash(bitPart)) ?? r.bitByCode.get(bitPart.toUpperCase());
}

/**
 * Risolve una riga combo. Copre tre forme, nell'ordine:
 *  1) BX a 3 parti (blade / ratchet / bit), incl. nomi Western e prefisso-username conservativo;
 *  2) CX (lockChip+mainBlade[+over]+assist / ratchet / bit) via cx-resolve (order-agnostic, Western);
 *  3) bey a ratchet integrato (blade `integratedRatchet` + bit, senza ratchet).
 * Ciò che non risolve univocamente resta unresolved con reason (poi → ledger), niente combo inventate.
 */
export function parseComboLine(r: Resolver, rawLine: string): ComboLineResult {
  const line = rawLine.trim().replace(/^[-••]\s*/, '').replace(STAGE_RE, '').trim();
  if (!line) return { ok: false, reason: 'riga vuota' };
  const m = line.match(RATCHET_RE);
  if (!m) return parseIntegratedLine(r, line);

  const ratchet = m[0];
  const idx = m.index ?? 0;
  const bladePart = line.slice(0, idx).trim();
  const bitPart = line.slice(idx + ratchet.length).trim();
  if (!bladePart) return { ok: false, reason: 'blade mancante prima del ratchet' };
  if (!r.ratchet.has(ratchet)) return { ok: false, reason: `ratchet non riconosciuto: ${ratchet}` };
  if (!bitPart) return { ok: false, reason: 'bit mancante dopo il ratchet' };
  const bit = resolveBit(r, bitPart);
  if (!bit) return { ok: false, reason: `bit/sigla non risolto: "${bitPart}"` };

  // 1) BX diretto
  const b = r.blade.get(squash(bladePart));
  if (b) {
    return {
      ok: true,
      combo: {
        id: `${b.id}-${ratchet}-${bit.id}`, line: 'bx', blade: b.id, ratchet, bit: bit.id,
        lockChip: null, mainBlade: null, assistBlade: null, overBlade: null,
        displayName: `${b.name} ${ratchet} ${bit.name}`, type: b.type,
      },
    };
  }

  // 2) CX
  const cxr = resolveCxBladePart(r.cx, bladePart);
  if (cxr.ok) {
    const cx = cxr.cx;
    const type = (cx.mainBlade.type as BladeType) ?? 'balance';
    return {
      ok: true,
      combo: {
        id: cxComboId(cx, ratchet, bit.id), line: 'cx', blade: null, ratchet, bit: bit.id,
        lockChip: cx.lockChip.id, mainBlade: cx.mainBlade.id, assistBlade: cx.assistBlade.id,
        overBlade: cx.overBlade ? cx.overBlade.id : null,
        displayName: cxDisplayName(cx, ratchet, bit.name), type,
      },
    };
  }
  if (cxr.ambiguous) return { ok: false, reason: `blade CX ambiguo: "${bladePart}" (split multiplo)` };

  // 3) BX con prefisso-username: togli il 1° token se il resto è un blade BX noto e t0 no
  const toks = bladePart.split(/\s+/).filter(Boolean);
  if (toks.length >= 2) {
    const tail = r.blade.get(squash(toks.slice(1).join(' ')));
    if (tail && !r.blade.get(squash(toks[0]))) {
      return {
        ok: true,
        combo: {
          id: `${tail.id}-${ratchet}-${bit.id}`, line: 'bx', blade: tail.id, ratchet, bit: bit.id,
          lockChip: null, mainBlade: null, assistBlade: null, overBlade: null,
          displayName: `${tail.name} ${ratchet} ${bit.name}`, type: tail.type,
        },
      };
    }
  }

  return { ok: false, reason: `blade non risolto: "${bladePart}" (CX o nome ignoto)` };
}

/**
 * Riga senza ratchet. Può essere un bey a ratchet integrato (Cutter Shinobi, Bullet Griffon, ...),
 * scritto come "[blade integrato] [bit]". Non viene materializzato come combo (la pipeline a valle e
 * la UI assumono un ratchet a 3 parti), ma se riconosciuto si dà un reason chiaro per il ledger; il
 * flag `integratedRatchet` del registro distingue il bey integrato legittimo dalla riga-rumore.
 */
function parseIntegratedLine(r: Resolver, line: string): ComboLineResult {
  const toks = line.split(/\s+/).filter(Boolean);
  for (let cut = toks.length - 1; cut >= 1; cut--) {
    const bit = resolveBit(r, toks.slice(cut).join(' '));
    if (!bit) continue;
    const b = r.blade.get(squash(toks.slice(0, cut).join(' ')));
    if (b && b.integratedRatchet) {
      return { ok: false, reason: `bey a ratchet integrato (${b.name}, fuori scope combo a 3 parti)` };
    }
  }
  return { ok: false, reason: 'nessun ratchet (bey integrato come Bullet Griffon, o riga non-combo)' };
}

// ---- Parsing dei campi header (deterministico) ---------------------------

const slugify = (s: string) =>
  norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';

/**
 * eventId stabile e label-agnostico (scansiona tutto l'header, non solo "Event Page Link:").
 * Preferisce il thread-id WBO (--N) al pid (anchor per-post, meno stabile tra fetch), poi lo slug
 * Challonge (togliendo il prefisso locale tipo /tr/, /es/), infine slug(titolo)+data.
 */
export function parseEventId(headerText: string, title: string, date: string): string {
  const thread = headerText.match(/worldbeyblade\.org\/Thread-[^\s)]*?--(\d+)/i);
  if (thread) return `wbo-thread-${thread[1]}`;
  const pid = headerText.match(/\bpid(\d+)/i);
  if (pid) return `wbo-pid-${pid[1]}`;
  const ch = headerText.match(/challonge\.com\/(?:[a-z]{2}\/)?([a-z0-9]+)/i);
  if (ch) return `wbo-challonge-${ch[1].toLowerCase()}`;
  return `wbo-${slugify(title)}-${date}`;
}

const MONTH_ABBR: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Ritorna 'YYYY-MM-DD' solo se è una data di calendario reale (no mese>12, no rollover tipo 06-31). */
function isoIfValid(yyyy: string, mm: string, dd: string): string | null {
  const y = +yyyy, m = +mm, d = +dd;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(iso + 'T00:00:00Z');
  if (isNaN(t.getTime()) || t.getUTCMonth() + 1 !== m || t.getUTCDate() !== d) return null;
  return iso;
}

/**
 * Data evento, in ordine di preferenza: "Date: MM/DD/YYYY" → timestamp del post "Mon. GG, AAAA"
 * (formato MyBB, es. "Jun. 09, 2026") → qualsiasi MM/DD/YYYY nell'header → fallback al fetchedAt
 * (alcuni eventi non riportano data: senza fallback si perderebbe l'intero podio, e lo scoring ha
 * bisogno di una data per il decay). Ogni candidato è validato: una data non di calendario è scartata.
 */
export function parseDate(headerText: string, fetchedAt: string): string {
  const labeled = headerText.match(/Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (labeled) { const iso = isoIfValid(labeled[3], labeled[1], labeled[2]); if (iso) return iso; }
  const abbr = headerText.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})\b/);
  if (abbr) { const iso = isoIfValid(abbr[3], MONTH_ABBR[abbr[1].toLowerCase()], abbr[2]); if (iso) return iso; }
  const any = headerText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (any) { const iso = isoIfValid(any[3], any[1], any[2]); if (iso) return iso; }
  return fetchedAt;
}

export function parsePlayers(headerText: string): number | undefined {
  const pc = headerText.match(/Player Count:\s*(\d+)/i);
  if (pc) return parseInt(pc[1], 10);
  const part = headerText.match(/(\d+)\s+Participants/i);
  if (part) return parseInt(part[1], 10);
  const tourn = headerText.match(/(\d+)\s+player\s+tournament/i);
  if (tourn) return parseInt(tourn[1], 10);
  return undefined;
}

/**
 * Stadio del torneo (piatto). Beyblade X overseas gira quasi solo su Xtreme; i tornei ufficiali JP
 * usano l'Infinity. Si legge dalla riga "Stadium: ..." dell'header. undefined = sconosciuto
 * (MetaBeys non lo espone). Esposto come filtro/badge in UI, NON usato nel calcolo dello score.
 */
export function parseStadium(headerText: string): 'xtreme' | 'infinity' | undefined {
  const m = headerText.match(/Stadium:\s*([^\n]+)/i);
  const hay = m ? m[1] : '';
  if (/infinity/i.test(hay)) return 'infinity';
  if (/x-?treme|extreme/i.test(hay)) return 'xtreme';
  return undefined;
}

// ---- Segmentazione deterministica del thread -----------------------------

export interface SegPlacement { rank: number; comboLinesRaw: string[] }
export interface SegEvent { eventName: string; headerRaw: string; placements: SegPlacement[] }

const ROLE_RE = /^\s*(ORGANIZER|MEMBER|ADMINISTRATOR|MODERATOR|COMMITTEE)\s*$/;
const PLACEMENT_RE = /^(\d+)(?:st|nd|rd|th)\b(?:\s+place)?:?/i;
// Le medaglie sono caratteri astrali (surrogate pair): l[0] ne darebbe solo metà, quindi startsWith.
function medalRank(l: string): number | undefined {
  if (l.startsWith('🥇')) return 1;
  if (l.startsWith('🥈')) return 2;
  if (l.startsWith('🥉')) return 3;
  return undefined;
}
const HEADER_NOISE_RE =
  /^(Optional Rules|Stadium|First Stage|Final Stage|Second Stage|Date:|Event Page|Bracket Link|Location|Discord|Match Type|Stage \d|RANKED|UNRANKED|WBO Ranked)/i;

/**
 * Nome evento dall'header del post. Strategia (in ordine):
 *  1) titolo dal link al thread dell'evento (slug prima di `--N`) — il nome "ufficiale" WBO;
 *  2) prima riga-titolo: con spazi e non un handle/metadato utente (i nomi utente sono token unici).
 * Fix: l'euristica precedente prendeva la PRIMA riga utile dell'header, che spesso è lo username del
 * poster (es. "Shawn514", "anon7437"), non il nome del torneo. Restituisce '' se nulla è adatto
 * (assembleEvidence ripiega su eventId).
 */
export function parseEventName(headerText: string, headerLines: string[]): string {
  const thread = headerText.match(/worldbeyblade\.org\/Thread-([A-Za-z0-9-]+?)--\d+/i);
  if (thread) {
    const title = thread[1].replace(/-+/g, ' ').trim();
    if (title.length > 2) return title;
  }
  const ch = headerText.match(/challonge\.com\/(?:[a-z]{2}\/)?([a-z0-9]+)/i);
  const titleLine = headerLines.find(
    (l) =>
      /\s/.test(l) &&                                  // i titoli hanno spazi, gli username no
      !/^(Today|Yesterday|\d+\s+(hours?|minutes?|days?|weeks?)\s+ago)/i.test(l) &&
      !/(METAL|BURST)\s+[\d,]+\s+BR/.test(l) &&
      !/^(Login|Join Now|Tournaments|Prev|Posts?:|Threads?:|Reputation|Joined|\(current\))/i.test(l) &&
      !HEADER_NOISE_RE.test(l),
  );
  if (titleLine) return titleLine.replace(/https?:\/\/\S+/g, '').replace(/[\s:]+$/, '').trim();
  if (ch) return ch[1];
  return '';
}

/**
 * Segmentatore deterministico (regex): spezza i post sulle righe-ruolo, scarta le citazioni
 * ("Wrote:") e l'header/footer di pagina (i blocchi prima del primo ORGANIZER sono esclusi), e
 * raccoglie sotto ogni marcatore (1st / 1st Place: / 🥇🥈🥉) le righe che contengono un ratchet.
 */
export function segmentThread(raw: string): SegEvent[] {
  const lines = raw.split('\n');
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const ln of lines) {
    if (ROLE_RE.test(ln)) { cur = []; blocks.push(cur); continue; }
    if (cur) cur.push(ln);
  }

  const events: SegEvent[] = [];
  for (const block of blocks) {
    const text = block.join('\n');
    if (/Wrote:/.test(text)) continue;     // citazione/discussione, non un evento
    const trimmed = block.map((l) => l.trim());
    const firstP = trimmed.findIndex((l) => PLACEMENT_RE.test(l) || medalRank(l) !== undefined);
    const headerLines = (firstP >= 0 ? trimmed.slice(0, firstP) : trimmed).filter(Boolean);
    const headerRaw = headerLines.join('\n');
    const eventName = parseEventName(headerRaw, headerLines);

    const placements: SegPlacement[] = [];
    if (firstP >= 0) {
      let curP: SegPlacement | null = null;
      for (let i = firstP; i < trimmed.length; i++) {
        const l = trimmed[i];
        if (!l) continue;
        if (HEADER_NOISE_RE.test(l)) { if (/^Optional Rules/i.test(l)) curP = null; continue; }
        const medal = medalRank(l);
        const pm = l.match(PLACEMENT_RE);
        if (medal !== undefined) { curP = { rank: medal, comboLinesRaw: [] }; placements.push(curP); continue; }
        if (pm) { curP = { rank: parseInt(pm[1], 10), comboLinesRaw: [] }; placements.push(curP); continue; }
        if (curP && RATCHET_RE.test(l)) curP.comboLinesRaw.push(l);
      }
    }
    events.push({ eventName, headerRaw, placements });
  }
  return events;
}

// ---- Assemblaggio dell'evidenza ------------------------------------------

export interface ComboAcc {
  id: string; line: 'bx' | 'cx';
  blade: string | null; ratchet: string; bit: string;
  lockChip?: string | null; mainBlade?: string | null; assistBlade?: string | null; overBlade?: string | null;
  displayName: string; type: BladeType;
  placements: PlacementEvidence[]; usage: UsageEvidence[];
}
export interface UnresolvedItem { line: string; reason: string; ctx?: string }
export interface WboEvidence {
  combos: Record<string, ComboAcc>;
  unresolved: UnresolvedItem[];
  stats: {
    events: number; eventsWithPodium: number; combosResolved: number;
    placements: number; unresolved: number;
  };
}

/**
 * Trasforma gli eventi segmentati in evidenza: risolve ogni riga-combo,
 * accumula i combo per id-set, deduplica i placement per (eventId, posizione, comboId) — così la
 * stessa combo usata in "First Stage" e "Final Stage" non conta due volte — e ordina l'output per
 * diff git stabili (l'ordine del raw cambia a ogni fetch).
 */
/**
 * `corrections`: mappa opzionale `norm(riga) → riga corretta`, popolata fuori banda dal subagent typo
 * di /update-combos (proposte già passate per il gate "ri-parsa e risolve" + giudice). Applicata PRIMA
 * di parseComboLine, così un refuso ("SliverWolf" → "Silver Wolf") risolve IN CONTESTO (data/evento) e
 * sparisce dal ledger. Codice deterministico: si limita a sostituire e ri-parsare; non indovina nulla.
 */
export function assembleEvidence(
  events: SegEvent[],
  r: Resolver,
  fetchedAt: string,
  sourceUrl: string,
  corrections?: Record<string, string>,
): WboEvidence {
  const combos = new Map<string, ComboAcc>();
  const unresolved: UnresolvedItem[] = [];
  const placementKeys = new Set<string>();
  let eventsWithPodium = 0;

  for (const ev of events) {
    const date = parseDate(ev.headerRaw, fetchedAt);
    const players = parsePlayers(ev.headerRaw);
    const stadium = parseStadium(ev.headerRaw);
    const eventId = parseEventId(ev.headerRaw, ev.eventName || 'wbo-event', date);
    const eventName = ev.eventName || eventId;

    // Cutoff condiviso: scarta l'intero evento se più vecchio di 12 mesi (tutti i suoi placement
    // condividono la stessa data). Il backfill storico paginerà oltre, ma l'evidenza si ferma qui.
    if (!isFresh(date)) {
      unresolved.push({ line: eventName, reason: `oltre-cutoff (${date})`, ctx: eventId });
      continue;
    }

    if (!ev.placements.length) {
      unresolved.push({ line: eventName, reason: 'nessun marcatore di piazzamento (deck list senza podio)', ctx: eventId });
      continue;
    }
    eventsWithPodium++;

    for (const p of ev.placements) {
      for (const rawLine of p.comboLinesRaw) {
        const fixed = corrections?.[norm(rawLine)];
        const res = parseComboLine(r, fixed ?? rawLine);
        if (!res.ok) {
          unresolved.push({ line: rawLine.trim(), reason: res.reason, ctx: `${eventId} ${p.rank}°` });
          continue;
        }
        const c = res.combo;
        let acc = combos.get(c.id);
        if (!acc) {
          acc = {
            id: c.id, line: c.line, blade: c.blade, ratchet: c.ratchet, bit: c.bit,
            lockChip: c.lockChip ?? null, mainBlade: c.mainBlade ?? null,
            assistBlade: c.assistBlade ?? null, overBlade: c.overBlade ?? null,
            displayName: c.displayName, type: c.type, placements: [], usage: [],
          };
          combos.set(c.id, acc);
        }
        const key = `${eventId}|${p.rank}|${c.id}`;
        if (placementKeys.has(key)) continue;
        placementKeys.add(key);
        acc.placements.push({
          source: SOURCE_ID, tier: 'structured', eventId, eventName, date,
          placement: p.rank, players, stadium, lang: 'en', url: sourceUrl,
        });
      }
    }
  }

  const outCombos: Record<string, ComboAcc> = {};
  for (const id of [...combos.keys()].sort()) {
    const acc = combos.get(id)!;
    acc.placements.sort((a, b) =>
      `${a.date}|${a.eventId}|${a.placement}`.localeCompare(`${b.date}|${b.eventId}|${b.placement}`),
    );
    outCombos[id] = acc;
  }
  const placements = Object.values(outCombos).reduce((n, c) => n + c.placements.length, 0);

  return {
    combos: outCombos,
    unresolved,
    stats: {
      events: events.length,
      eventsWithPodium,
      combosResolved: combos.size,
      placements,
      unresolved: unresolved.length,
    },
  };
}
