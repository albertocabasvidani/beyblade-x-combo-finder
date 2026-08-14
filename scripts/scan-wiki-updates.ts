/**
 * scan-wiki-updates.ts — Scoperta e diff DETERMINISTICI delle pagine wiki per /update-parts.
 *
 * Prima questo lavoro lo improvvisava l'IA a ogni run, e il 14/08/2026 e' costato 21 minuti e 9
 * subagent per produrre ZERO parti nuove: confrontava tutti i link delle due pagine-lista contro
 * il solo `source.page` del master (una pagina canonica per parte), quindi le pagine Hasbro (che
 * sono #REDIRECT), i Dual Pack, i Multipack, i Random Booster e gli accessori risultavano "nuovi"
 * ogni singolo giorno. Qui la scoperta e' codice; all'IA resta solo leggere il wikitext delle
 * pagine davvero nuove o cambiate.
 *
 * Stato in `data/wiki-scan.json`, di proprieta' esclusiva di questo script. NON si scrive piu'
 * `scannedPages` dentro scan-history.json: quel file lo riscrivono per intero anche i job delle
 * 07:30 (fetch-metabeys/wbo/sheets), e due read-modify-write da 900 KB sovrapposti si perdono a
 * vicenda. In scan-history restano le chiavi non-wiki, che servono al dedup per contentHash di
 * /update-combos.
 *
 * Modi:
 *   (nessun flag)  scan: produce tmp/parts-worklist.json + prefetch del wikitext
 *   --record       registra in wiki-scan.json l'esito di un run RIUSCITO
 *   --migrate      one-off: costruisce wiki-scan.json dalle chiavi fandom di scan-history.json
 *
 * Flag di collaudo (default = percorsi reali, la suite non tocca mai data/):
 *   --state <path> --worklist <path> --lists-from <dir> --results <path> --seed-known
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  batchQuery, fetchWikitextAtRev, titleFromKey, titleToUrl, sanitizeFilename,
  writeJsonAtomic, readJson, today, toIso, type PageInfo,
} from './lib/wiki';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const TMP = join(ROOT, 'tmp');

const LIST_TITLES = [
  'List of Beyblade X products (Takara Tomy)',
  'List of Beyblade X products (Hasbro)',
];

// Pagine che compaiono nelle liste ma non sono prodotti: nessuna parte da estrarne mai.
const META_TITLES = new Set(['Beyblade X', 'Beyblade X (generation)', 'Takara Tomy', 'Hasbro', 'CoroCoro Comic']);

type Kind = 'product' | 'part' | 'set' | 'randombooster' | 'multipack' | 'accessory' | 'game' | 'meta' | 'missing';
/** Tipi che non contengono mai parti: un loro cambio di revid si registra senza scomodare l'IA. */
const KIND_SENZA_PARTI: ReadonlySet<Kind> = new Set<Kind>(['accessory', 'game', 'meta', 'missing']);

interface PageState {
  revid: number | null;
  timestamp: string | null;
  lastScannedDate: string;
  kind: Kind;
  kindSource: 'heuristic' | 'ai';
  redirects?: string[];
  notes?: string;
}
interface ListState { revid: number; timestamp: string | null; lastScannedDate: string }
interface State { version: number; lists: Record<string, ListState>; pages: Record<string, PageState> }

interface WorkPage {
  title: string; url: string; revid: number; timestamp: string | null;
  reason: 'new' | 'changed'; prevRevid?: number | null;
  redirectedFrom?: string[]; kind: Kind; kindSource: 'heuristic' | 'ai';
  via: string; file: string;
}
interface Worklist {
  generated: string;
  listRevids: Record<string, { revid: number; timestamp: string | null }>;
  counts: { new: number; changed: number; missing: number; autoRefresh: number };
  pages: WorkPage[];
  /** Pagine cambiate ma di tipo senza parti: solo revid da rinfrescare, nessun lavoro per l'IA. */
  autoRefresh: { title: string; revid: number; timestamp: string | null; kind: Kind }[];
  missing: { title: string; linkedFrom: string }[];
}

// ---------------------------------------------------------------- argomenti
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string, def: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const STATE_PATH = opt('--state', join(DATA, 'wiki-scan.json'));
const WORKLIST_PATH = opt('--worklist', join(TMP, 'parts-worklist.json'));
const RESULTS_PATH = opt('--results', join(TMP, 'parts-worklist-results.json'));
const LISTS_FROM = opt('--lists-from', '');
const FETCH_DIR = opt('--fetch-dir', join(TMP, 'wiki_fetch'));

// ---------------------------------------------------------------- parsing liste

/**
 * Titoli di prodotto dalle tabelle delle pagine-lista.
 *
 * Le righe wikitable sono MULTI-LINEA: la cella col codice sta su una riga e il [[link]] col nome
 * sulla successiva, dentro lo stesso blocco `|-`. Per questo si spezza sui separatori di riga e si
 * ragiona per blocco, invece di raccogliere tutti i [[...]] della pagina come si faceva prima.
 *
 * Una riga vale se ha una cella-codice (BX-/UX-/CX-/F####/G#### o "N/A", usato dai Limited
 * Releases) E un link non-File. Cosi' cadono da soli: le pseudo-intestazioni `! colspan` (niente
 * link), le decine di [[File:Flag of ...]] nelle celle di data e prezzo della lista Hasbro, e il
 * blocco introduttivo che linka [[Beyblade X]] senza codice.
 */
export function parseListRows(wikitext: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const block of wikitext.split(/\n\|-/)) {
    if (!/^\s*\|\s*(?:(?:BX|UX|CX|BXG)-[\w.]+|[FG]\d{4}|N\/A)/m.test(block)) continue;
    const m = [...block.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)]
      .map((x) => x[1].trim())
      .filter((t) => t && !/^(File|Image|Category|Template|User):/i.test(t));
    if (!m.length) continue;
    const title = m[0];
    if (seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  return out;
}

/** Link della sezione ==Contents==: i Multipack elencano li' i bey membri, che spesso non stanno in nessuna lista. */
export function parseContentsLinks(wikitext: string): string[] {
  const m = wikitext.match(/^==\s*Contents\s*==\s*$([\s\S]*?)(?=^==[^=]|\Z)/m);
  if (!m) return [];
  return [...m[1].matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)]
    .map((x) => x[1].trim())
    .filter((t) => t && !/^(File|Image|Category|Template|User):/i.test(t));
}

/** Classificazione sul titolo CANONICO: "X-treme Battlers Pack" e' un redirect a una pagina bey. */
export function classifyKind(title: string): Kind {
  if (META_TITLES.has(title)) return 'meta';
  if (/^(Bit|Ratchet|Lock Chip|Main Blade|Assist Blade|Over Blade|Metal Blade|Blade) - /i.test(title)) return 'part';
  if (/\b(Multipack Set|Dual Pack|Team Pack|Battlers Pack|Expansion Pack)\b/i.test(title)) return 'multipack';
  if (/^Random Booster\b/i.test(title)) return 'randombooster';
  // "Stadium" senza \b iniziale: i titoli Hasbro dicono "Beystadium" (una sola parola), che
  // \bStadium\b non prende — e quei tre finivano classificati come prodotti da estrarre.
  if (/(Stadium|Launcher|Grip|Winder|Gear Case|Deck Case|Carry Case|Storage Box|Beybattle Pass|Battle Base|Sticker)/i.test(title)) return 'accessory';
  if (/\bBeyblade X:\s/i.test(title)) return 'game';
  if (/\b(Deck Set|Deck Starter|Dash Set|Anniversary Set|Battle Set|Entry Set|Booster Set|Starter Set)\b/i.test(title)) return 'set';
  return 'product';
}

// ---------------------------------------------------------------- utilita' di stato

function loadState(): State {
  return readJson<State>(STATE_PATH, { version: 1, lists: {}, pages: {} });
}

function fetchFileFor(title: string): string {
  return join(FETCH_DIR, sanitizeFilename(title) + '.json');
}

/** Ripulisce gli artefatti del run precedente: un batch stantio verrebbe ri-mergiato da merge-master. */
function pulisciTmp(): void {
  mkdirSync(TMP, { recursive: true });
  let files: string[] = [];
  try { files = readdirSync(TMP); } catch { /* tmp non esiste ancora */ }
  for (const f of files) {
    if (/^parts-extract-batch-.*\.json$/.test(f) || f === 'parts-extract-cx-pilot.json' ||
        f === 'parts-extract-update.json' || /^parts-worklist.*\.json$/.test(f)) {
      try { unlinkSync(join(TMP, f)); } catch { /* gia' sparito */ }
    }
  }
  try { rmSync(FETCH_DIR, { recursive: true, force: true }); } catch { /* idem */ }
  mkdirSync(FETCH_DIR, { recursive: true });
}

async function listWikitext(title: string, revid: number | null): Promise<string> {
  if (LISTS_FROM) return readFileSync(join(LISTS_FROM, sanitizeFilename(title) + '.txt'), 'utf8');
  if (revid == null) throw new Error(`revid mancante per la lista ${title}`);
  return fetchWikitextAtRev(revid);
}

// ---------------------------------------------------------------- scan

async function scan(): Promise<void> {
  const state = loadState();
  if (!Object.keys(state.pages).length && !LISTS_FROM) {
    console.error(`ERRORE: ${STATE_PATH} assente o vuoto. Eseguire prima: npx tsx scripts/scan-wiki-updates.ts --migrate`);
    process.exit(1);
  }
  pulisciTmp();

  // --- pagine-lista: se i revid non sono cambiati non c'e' niente di nuovo da scoprire li' dentro
  const listInfo = await batchQuery(LIST_TITLES);
  const listRevids: Worklist['listRevids'] = {};
  let listeCambiate = false;
  for (const t of LIST_TITLES) {
    const info = listInfo.get(t);
    if (!info || info.revid == null) throw new Error(`pagina-lista non leggibile: ${t}`);
    listRevids[info.canonical] = { revid: info.revid, timestamp: info.timestamp };
    if (state.lists[info.canonical]?.revid !== info.revid) listeCambiate = true;
  }
  if (LISTS_FROM) listeCambiate = true; // in collaudo le fixture comandano

  // --- candidati dalle liste -> titoli canonici
  const nuove: { title: string; info: PageInfo; via: string }[] = [];
  const missing: Worklist['missing'] = [];
  if (listeCambiate) {
    const candidati = new Map<string, string>(); // titolo grezzo -> lista di provenienza
    for (const t of LIST_TITLES) {
      const wt = await listWikitext(t, listInfo.get(t)!.revid);
      for (const titolo of parseListRows(wt)) if (!candidati.has(titolo)) candidati.set(titolo, t);
    }
    console.log(`Liste: ${candidati.size} titoli candidati.`);

    const canon = await batchQuery([...candidati.keys()]);
    for (const [grezzo, info] of canon) {
      if (state.pages[info.canonical]) continue;
      if (info.missing) {
        missing.push({ title: info.canonical, linkedFrom: candidati.get(grezzo)! });
        continue;
      }
      if (nuove.some((n) => n.info.canonical === info.canonical)) continue;
      nuove.push({ title: info.canonical, info, via: 'list' });
    }
  } else {
    console.log('Liste invariate (revid identici): salto il parsing.');
  }

  // --- pagine gia' note: diff sui revid (incluse le missing, che possono materializzarsi)
  const noti = Object.keys(state.pages);
  const infoNoti = noti.length ? await batchQuery(noti) : new Map<string, PageInfo>();
  const cambiate: { title: string; info: PageInfo; prev: number | null; kind: Kind; kindSource: 'heuristic' | 'ai'; reason: 'new' | 'changed' }[] = [];
  const sparite: string[] = [];
  for (const titolo of noti) {
    const prevState = state.pages[titolo];
    const info = infoNoti.get(titolo);
    if (!info) continue;
    if (info.missing) {
      if (prevState.revid != null) sparite.push(titolo);
      continue;
    }
    if (info.revid === prevState.revid) continue;
    if (prevState.revid == null) {
      // Era un link rosso e ora la pagina esiste: e' una novita' vera, non un aggiornamento.
      // Tenere il kind 'missing' la manderebbe fra i soli-revid e non verrebbe MAI estratta —
      // cioe' un prodotto annunciato prima della sua pagina resterebbe fuori dal registro.
      cambiate.push({ title: info.canonical, info, prev: null, kind: classifyKind(info.canonical), kindSource: 'heuristic', reason: 'new' });
      continue;
    }
    cambiate.push({ title: info.canonical, info, prev: prevState.revid, kind: prevState.kind, kindSource: prevState.kindSource, reason: 'changed' });
  }

  // Le pagine senza parti (accessori, videogiochi, meta) si limitano a rinfrescare il revid.
  const autoRefresh: Worklist['autoRefresh'] = [];
  const daLavorare: WorkPage[] = [];
  for (const c of cambiate) {
    if (KIND_SENZA_PARTI.has(c.kind)) {
      autoRefresh.push({ title: c.title, revid: c.info.revid!, timestamp: c.info.timestamp, kind: c.kind });
      continue;
    }
    daLavorare.push({
      title: c.title, url: titleToUrl(c.title), revid: c.info.revid!, timestamp: c.info.timestamp,
      reason: c.reason, prevRevid: c.prev, kind: c.kind, kindSource: c.kindSource, via: 'list',
      file: fetchFileFor(c.title),
    });
  }
  for (const n of nuove) {
    const kind = classifyKind(n.title);
    const page: WorkPage = {
      title: n.title, url: titleToUrl(n.title), revid: n.info.revid!, timestamp: n.info.timestamp,
      reason: 'new', kind, kindSource: 'heuristic', via: n.via, file: fetchFileFor(n.title),
    };
    if (KIND_SENZA_PARTI.has(kind)) autoRefresh.push({ title: n.title, revid: n.info.revid!, timestamp: n.info.timestamp, kind });
    else daLavorare.push(page);
  }

  // --- prefetch + fixpoint ==Contents== (i membri dei multipack non stanno nelle liste)
  const visti = new Set(daLavorare.map((p) => p.title));
  let frontiera = [...daLavorare];
  for (let depth = 0; depth < 2 && frontiera.length; depth++) {
    const prossimi: WorkPage[] = [];
    for (const p of frontiera) {
      const wt = await fetchWikitextAtRev(p.revid);
      writeFileSync(p.file, JSON.stringify({ title: p.title, revid: p.revid, wikitext: wt }, null, 2) + '\n');
      const membri = parseContentsLinks(wt).filter((t) => !visti.has(t) && !state.pages[t]);
      if (!membri.length) continue;
      const canon = await batchQuery(membri);
      for (const [, info] of canon) {
        if (info.missing || visti.has(info.canonical) || state.pages[info.canonical]) continue;
        const kind = classifyKind(info.canonical);
        visti.add(info.canonical);
        if (KIND_SENZA_PARTI.has(kind)) {
          autoRefresh.push({ title: info.canonical, revid: info.revid!, timestamp: info.timestamp, kind });
          continue;
        }
        prossimi.push({
          title: info.canonical, url: titleToUrl(info.canonical), revid: info.revid!, timestamp: info.timestamp,
          reason: 'new', kind, kindSource: 'heuristic', via: `contents:${p.title}`, file: fetchFileFor(info.canonical),
        });
      }
    }
    daLavorare.push(...prossimi);
    frontiera = prossimi;
  }

  const worklist: Worklist = {
    generated: new Date().toISOString(),
    listRevids,
    counts: {
      new: daLavorare.filter((p) => p.reason === 'new').length,
      changed: daLavorare.filter((p) => p.reason === 'changed').length,
      missing: missing.length,
      autoRefresh: autoRefresh.length,
    },
    pages: daLavorare,
    autoRefresh,
    missing,
  };
  writeJsonAtomic(WORKLIST_PATH, worklist);

  console.log(`\nWorklist: ${worklist.counts.new} nuove, ${worklist.counts.changed} cambiate, ` +
    `${autoRefresh.length} solo-revid, ${missing.length} inesistenti.`);
  if (sparite.length) console.log(`ATTENZIONE: ${sparite.length} pagine note ora inesistenti: ${sparite.join(', ')}`);
  for (const p of daLavorare) console.log(`  [${p.reason}/${p.kind}] ${p.title}  (via ${p.via})`);

  if (!daLavorare.length) {
    // Niente da estrarre: registrare qui i revid e' sicuro, non c'e' altro lavoro che una
    // morte improvvisa potrebbe far perdere. Cosi' domani le liste non si riparsano.
    for (const [titolo, r] of Object.entries(listRevids)) {
      state.lists[titolo] = { revid: r.revid, timestamp: r.timestamp, lastScannedDate: today() };
    }
    registraAuto(state, autoRefresh, missing);
    writeJsonAtomic(STATE_PATH, state);
    console.log('\nWORKLIST VUOTA');
  }
}

/** Registra cio' che non richiede l'IA: revid rinfrescati e pagine inesistenti (revid null). */
function registraAuto(state: State, autoRefresh: Worklist['autoRefresh'], missing: Worklist['missing']): void {
  for (const a of autoRefresh) {
    const prev = state.pages[a.title];
    state.pages[a.title] = {
      ...prev,
      revid: a.revid, timestamp: toIso(a.timestamp), lastScannedDate: today(),
      kind: prev?.kind ?? a.kind, kindSource: prev?.kindSource ?? 'heuristic',
    };
  }
  for (const m of missing) {
    if (state.pages[m.title]) continue;
    // Un link rosso (oggi: HornetFortR7-60T nella lista TT) va ricordato, altrimenti risulta
    // "nuovo" ogni giorno per sempre. Resta nel diff: se la pagina nasce, il revid compare.
    state.pages[m.title] = {
      revid: null, timestamp: null, lastScannedDate: today(),
      kind: 'missing', kindSource: 'heuristic', notes: `link rosso in ${m.linkedFrom}`,
    };
  }
}

// ---------------------------------------------------------------- record

async function record(): Promise<void> {
  const state = loadState();
  const worklist = readJson<Worklist | null>(WORKLIST_PATH, null);
  if (!worklist) throw new Error(`${WORKLIST_PATH} assente: eseguire prima lo scan.`);
  const results = readJson<{ pages?: any[]; extraPages?: any[] }>(RESULTS_PATH, {});
  const byTitle = new Map<string, any>();
  for (const r of results.pages ?? []) if (r?.title) byTitle.set(r.title, r);

  for (const p of worklist.pages) {
    const r = byTitle.get(p.title);
    const prev = state.pages[p.title];
    state.pages[p.title] = {
      revid: p.revid,
      timestamp: toIso(p.timestamp),
      lastScannedDate: today(),
      kind: (r?.kind as Kind) ?? p.kind,
      kindSource: r?.kind ? 'ai' : 'heuristic',
      ...(p.redirectedFrom?.length || prev?.redirects?.length
        ? { redirects: [...new Set([...(prev?.redirects ?? []), ...(p.redirectedFrom ?? [])])] } : {}),
      ...(r?.notes ? { notes: r.notes } : prev?.notes ? { notes: prev.notes } : {}),
    };
  }
  registraAuto(state, worklist.autoRefresh ?? [], worklist.missing ?? []);

  // Pagine toccate fuori worklist (membri estratti a mano, healing di verify:wiki): revid fresco.
  const extra = (results.extraPages ?? []).map((e: any) => e?.title).filter(Boolean);
  if (extra.length) {
    const info = await batchQuery(extra);
    for (const [richiesto, i] of info) {
      const r = (results.extraPages ?? []).find((e: any) => e.title === richiesto);
      if (i.missing) continue;
      state.pages[i.canonical] = {
        revid: i.revid, timestamp: toIso(i.timestamp), lastScannedDate: today(),
        kind: (r?.kind as Kind) ?? classifyKind(i.canonical),
        kindSource: r?.kind ? 'ai' : 'heuristic',
        ...(r?.notes ? { notes: r.notes } : {}),
      };
    }
  }

  for (const [titolo, r] of Object.entries(worklist.listRevids)) {
    state.lists[titolo] = { revid: r.revid, timestamp: toIso(r.timestamp), lastScannedDate: today() };
  }

  writeJsonAtomic(STATE_PATH, state);
  console.log(`Registrate ${worklist.pages.length} pagine di worklist, ${worklist.autoRefresh?.length ?? 0} solo-revid, ` +
    `${extra.length} extra, ${Object.keys(worklist.listRevids).length} liste in ${STATE_PATH}.`);
}

// ---------------------------------------------------------------- migrate

async function migrate(): Promise<void> {
  const hist = readJson<any>(join(DATA, 'scan-history.json'), {});
  const scanned: Record<string, any> = hist.scannedPages ?? {};

  // Solo chiavi fandom: le altre (beybase, WBO, note.com) sono di /update-combos, che le
  // deduplica per contentHash. Questo script non le tocca e non riscrive scan-history.
  const perTitolo = new Map<string, { keys: string[]; entries: any[] }>();
  let esterne = 0;
  for (const [key, val] of Object.entries(scanned)) {
    const titolo = titleFromKey(key);
    if (!titolo) { esterne++; continue; }
    const g = perTitolo.get(titolo) ?? { keys: [], entries: [] };
    g.keys.push(key); g.entries.push(val);
    perTitolo.set(titolo, g);
  }
  console.log(`scan-history: ${Object.keys(scanned).length} chiavi, ${perTitolo.size} titoli wiki, ${esterne} esterne (lasciate stare).`);

  const canon = await batchQuery([...perTitolo.keys()]);

  // Raggruppare per titolo CANONICO, non per titolo di partenza: piu' titoli diversi collassano
  // sulla stessa pagina (i 26 gruppi TT+redirect Hasbro di scan-history). Scrivere direttamente
  // in state.pages[canonico] dentro il ciclo precedente farebbe vincere l'ultimo arrivato — che
  // e' proprio la voce-redirect col revid dello stub.
  interface Gruppo { entries: any[]; titoli: string[]; missing: boolean }
  const perCanonico = new Map<string, Gruppo>();
  for (const [titolo, g] of perTitolo) {
    const info = canon.get(titolo);
    if (!info) continue;
    const gr = perCanonico.get(info.canonical) ?? { entries: [], titoli: [], missing: !!info.missing };
    gr.entries.push(...g.entries.map((e) => ({ ...e, _titolo: titolo })));
    gr.titoli.push(titolo);
    perCanonico.set(info.canonical, gr);
  }

  const state: State = loadState();
  state.version = 1;
  let collassati = 0;

  for (const [canonico, g] of perCanonico) {
    if (g.titoli.length > 1) collassati++;

    // Revid conservativo: quello registrato sotto il titolo canonico se esiste, altrimenti il piu'
    // basso del gruppo. Le voci-redirect portano il revid dello STUB, che non e' confrontabile con
    // la pagina vera: usarlo direbbe "gia' vista" a una revisione mai letta. Sbagliare per difetto
    // costa una ri-estrazione; sbagliare per eccesso salta un aggiornamento in silenzio.
    const diretta = g.entries.find((e) => e._titolo === canonico);
    const revids = g.entries.map((e) => e?.revid).filter((r) => typeof r === 'number') as number[];
    const revid = typeof diretta?.revid === 'number' ? diretta.revid : (revids.length ? Math.min(...revids) : null);
    const ts = g.entries.map((e) => toIso(e?.timestamp)).find(Boolean) ?? null;
    const note = g.entries.map((e) => e?.notes).find(Boolean);
    const redirects = [...new Set(g.titoli.filter((t) => t !== canonico))];

    state.pages[canonico] = {
      revid: g.missing ? null : revid,
      timestamp: ts,
      lastScannedDate: g.entries.map((e) => e?.lastScannedDate).filter(Boolean).sort().pop() ?? today(),
      kind: g.missing ? 'missing' : classifyKind(canonico),
      kindSource: 'heuristic',
      ...(redirects.length ? { redirects } : {}),
      ...(note ? { notes: note } : {}),
    };
  }
  console.log(`${collassati} gruppi di titoli collassati su una pagina canonica.`);

  if (flag('--seed-known')) {
    const info = await batchQuery(LIST_TITLES);
    for (const t of LIST_TITLES) {
      const li = info.get(t)!;
      const wt = await fetchWikitextAtRev(li.revid!);
      const canonCand = await batchQuery(parseListRows(wt));
      for (const [, ci] of canonCand) {
        if (state.pages[ci.canonical]) continue;
        state.pages[ci.canonical] = {
          revid: ci.missing ? null : ci.revid, timestamp: toIso(ci.timestamp), lastScannedDate: today(),
          kind: ci.missing ? 'missing' : classifyKind(ci.canonical), kindSource: 'heuristic',
        };
      }
    }
  }

  writeJsonAtomic(STATE_PATH, state);
  const perKind: Record<string, number> = {};
  for (const p of Object.values(state.pages)) perKind[p.kind] = (perKind[p.kind] ?? 0) + 1;
  console.log(`Scritte ${Object.keys(state.pages).length} pagine in ${STATE_PATH}.`);
  console.log('Per tipo:', JSON.stringify(perKind));
}

// ---------------------------------------------------------------- main
// Solo se invocato come programma: la suite di test importa parseListRows/classifyKind/
// parseContentsLinks come funzioni pure, e un main() che parte all'import le renderebbe
// inutilizzabili (oltre a leggere lo stato vero durante i test).
const invocatoDaRiga = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (invocatoDaRiga) {
  const mode = flag('--migrate') ? migrate : flag('--record') ? record : scan;
  mode().catch((e) => { console.error(e); process.exit(1); });
}
