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

interface BladeRef { id: string; name: string; type: BladeType }
interface BitRef { id: string; name: string }
export interface Resolver {
  blade: Map<string, BladeRef>;
  bit: Map<string, BitRef>;        // per nome/alias (chiave squash)
  bitByCode: Map<string, BitRef>;  // per codice ufficiale (chiave uppercase, es. "H", "FB", "LR")
  ratchet: Set<string>;
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

  for (const b of parts.blades ?? []) {
    const v: BladeRef = { id: b.id, name: b.name, type: b.type as BladeType };
    addKey(blade, b.name, v);
    if (b.nameWestern) addKey(blade, b.nameWestern, v);
    for (const a of b.aliases ?? []) addKey(blade, a, v);
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
  return { blade, bit, bitByCode, ratchet };
}

// ---- Risoluzione di una riga combo ---------------------------------------

export interface ResolvedCombo {
  id: string; blade: string; ratchet: string; bit: string; displayName: string; type: BladeType;
}
export type ComboLineResult = { ok: true; combo: ResolvedCombo } | { ok: false; reason: string };

/**
 * Risolve una riga combo BX (es. "WizardRod 1-60Hexa", "SharkScale 1-70H"). Strategia: stacca il
 * primo ratchet \d-\d{2}; tutto ciò che precede è il blade, ciò che segue è il bit (per nome o
 * sigla ufficiale). Le CX (parole extra prima del ratchet) e le righe senza ratchet finiscono in
 * unresolved con reason, esattamente come parse-metabeys per i casi non a 3 parti.
 */
export function parseComboLine(r: Resolver, rawLine: string): ComboLineResult {
  const line = rawLine.trim().replace(/^[-••]\s*/, '').replace(STAGE_RE, '').trim();
  if (!line) return { ok: false, reason: 'riga vuota' };
  const m = line.match(RATCHET_RE);
  if (!m) return { ok: false, reason: 'nessun ratchet (bey integrato come Bullet Griffon, o riga non-combo)' };
  const ratchet = m[0];
  const idx = m.index ?? 0;
  const bladePart = line.slice(0, idx).trim();
  const bitPart = line.slice(idx + ratchet.length).trim();
  if (!bladePart) return { ok: false, reason: 'blade mancante prima del ratchet' };
  if (!r.ratchet.has(ratchet)) return { ok: false, reason: `ratchet non riconosciuto: ${ratchet}` };
  const b = r.blade.get(squash(bladePart));
  if (!b) return { ok: false, reason: `blade non risolto: "${bladePart}" (CX o nome ignoto)` };
  if (!bitPart) return { ok: false, reason: 'bit mancante dopo il ratchet' };
  const bit = r.bit.get(squash(bitPart)) ?? r.bitByCode.get(bitPart.toUpperCase());
  if (!bit) return { ok: false, reason: `bit/sigla non risolto: "${bitPart}"` };
  const id = `${b.id}-${ratchet}-${bit.id}`;
  return {
    ok: true,
    combo: { id, blade: b.id, ratchet, bit: bit.id, displayName: `${b.name} ${ratchet} ${bit.name}`, type: b.type },
  };
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

/**
 * Data evento: "Date: MM/DD/YYYY" → qualsiasi MM/DD/YYYY nell'header → fallback al fetchedAt della
 * cache (alcuni eventi, es. "115 player tournament in Turkiye", non hanno data: senza fallback si
 * perderebbe l'intero podio, e lo scoring ha bisogno di una data per il decay).
 */
export function parseDate(headerText: string, fetchedAt: string): string {
  const labeled = headerText.match(/Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  const any = labeled ?? headerText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (any) {
    const [, mm, dd, yyyy] = any;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
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
  id: string; line: 'bx'; blade: string; ratchet: string; bit: string;
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
export function assembleEvidence(
  events: SegEvent[],
  r: Resolver,
  fetchedAt: string,
  sourceUrl: string,
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

    if (!ev.placements.length) {
      unresolved.push({ line: eventName, reason: 'nessun marcatore di piazzamento (deck list senza podio)', ctx: eventId });
      continue;
    }
    eventsWithPodium++;

    for (const p of ev.placements) {
      for (const rawLine of p.comboLinesRaw) {
        const res = parseComboLine(r, rawLine);
        if (!res.ok) {
          unresolved.push({ line: rawLine.trim(), reason: res.reason, ctx: `${eventId} ${p.rank}°` });
          continue;
        }
        const c = res.combo;
        let acc = combos.get(c.id);
        if (!acc) {
          acc = {
            id: c.id, line: 'bx', blade: c.blade, ratchet: c.ratchet, bit: c.bit,
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
