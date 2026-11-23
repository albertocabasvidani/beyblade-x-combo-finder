/**
 * enrich-stats.ts — Arricchimento: aggiunge le stat ATK/DEF/STA alle parti nel master,
 * prese dall'infobox delle pagine Fandom DEDICATE.
 *
 * Categorie wiki lette, per lista del master:
 *   blades      <- Blades, Ratchet-Integrated Blades
 *   bits        <- Bits, Ratchet-Integrated Bits
 *   ratchets    <- Ratchets
 *   mainBlades  <- Main Blades, Metal Blades
 * L'abbinamento resta per nome esatto normalizzato (minuscole, solo lettere e cifre) del titolo senza
 * prefisso contro names.tt / names.hasbro / id, DENTRO la lista della parte: «Main Blade - Fort» e
 * «Metal Blade - Fortress» sono parti diverse e non si scambiano. Se due famiglie danno per la stessa
 * parte valori diversi, la parte e' «ambigua» e non si tocca.
 *
 * NON tocca i comandi agentici daily. Scrive `stats: {atk,def,sta}` (e, per le parti a due stati,
 * `statsAlt`) dentro data/parts-master.json (merge-master preserva i campi extra → sopravvivono ai
 * run giornalieri). Poi `npm run build:parts` li propaga in parts.json.
 *
 * Il valore di ogni campo dell'infobox si riconosce in una categoria, e la parte la prende se tutti e
 * tre i campi sono della stessa:
 *   intero      `25`                  → `stats`
 *   slash       `50/70`               → due stati (vedi sotto)
 *   freccia     `30 > 55`             → due stati (vedi sotto)
 *   prodotti    `55<br>60 (2.0)`      → DUE PRODOTTI, non due stati: la 2.0 e' un altro prodotto. La parte
 *                                       tiene il primo valore come `stats`, nessun `statsAlt`
 *   decimale    `8.5`                 → non applicato (le stat sono interi)
 *   altro                             → non applicato
 *   vuoto       campo assente o vuoto → nessun dato sul wiki
 *
 * Due stati: solo le parti in data/parts-due-stati.json (lista + id + kind mode|shift + labels
 * opzionali, nomi propri dei due stati se il produttore li da). Per quelle `stats` e' il primo valore e
 * `statsAlt = {kind, stats, labels?}` il secondo; se sul wiki il formato non e' piu' a due valori lo
 * script FALLISCE prima di scrivere. Una parte con due valori che NON e' nell'elenco non si scrive e
 * compare sotto «due valori, non in elenco»: se sia un modo o un cambio in corsa lo decide una persona.
 *
 * Sicurezza: se una richiesta al wiki fallisce o una categoria principale torna vuota lo script esce 1
 * PRIMA di scrivere; il master si scrive in un file temporaneo e poi si rinomina. Non cancella mai stat
 * esistenti (se una pagina smette di avere i valori, la parte tiene quelli che ha).
 *
 * Uso: npm run enrich:stats [-- --dry]   (--dry: non scrive, stampa solo gli elenchi)
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const ROOT = join(import.meta.dirname, '..');
const masterPath = join(ROOT, 'data', 'parts-master.json');
const dueStatiPath = join(ROOT, 'data', 'parts-due-stati.json');
const API = 'https://beyblade.fandom.com/api.php';
const UA = 'beyblade-x-combo-finder stats-enrichment';

export interface Stats { atk: number; def: number; sta: number }
export interface StatsAlt { kind: 'mode' | 'shift'; stats: Stats; labels?: [string, string] }
export type Motivo = 'intero' | 'slash' | 'freccia' | 'prodotti' | 'decimale' | 'altro' | 'vuoto';
export interface Dettaglio {
  motivo: Motivo;
  /** Valore da scrivere in `stats`: l'intero, o il primo valore di una coppia prodotto/2.0. */
  stats: Stats | null;
  /** [primo, secondo] stato, per `slash` e `freccia`. */
  stati: [Stats, Stats] | null;
  grezzi: string[];
}
/** Una parte a due stati dichiarata in data/parts-due-stati.json. */
export interface VoceDueStati { lista: string; id: string; kind: 'mode' | 'shift'; labels?: [string, string] }

/** Famiglie wiki da leggere per ogni lista del master (la prima di ogni lista e' quella «principale»). */
export const SORGENTI: Record<string, string[]> = {
  blades: ['Blades', 'Ratchet-Integrated Blades'],
  bits: ['Bits', 'Ratchet-Integrated Bits'],
  ratchets: ['Ratchets'],
  mainBlades: ['Main Blades', 'Metal Blades'],
};

export const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const stripPrefix = (title: string) => {
  const i = title.indexOf(' - ');
  return i >= 0 ? title.slice(i + 3) : title;
};

const RE_INTERO = /^\d+$/;
const RE_DECIMALE = /^\d+\.\d+$/;
const RE_SLASH = /^(\d+)\s*\/\s*(\d+)$/;
const RE_FRECCIA = /^(\d+)\s*>\s*(\d+)$/;
const RE_PRODOTTI = /^(\d+)\s*<br\s*\/?>\s*(\d+)\s*\(2\.0\)$/i;

type Campo = 'intero' | 'decimale' | 'slash' | 'freccia' | 'prodotti' | 'altro';
const classificaCampo = (g: string): Campo =>
  RE_INTERO.test(g) ? 'intero'
    : RE_DECIMALE.test(g) ? 'decimale'
    : RE_SLASH.test(g) ? 'slash'
    : RE_FRECCIA.test(g) ? 'freccia'
    : RE_PRODOTTI.test(g) ? 'prodotti'
    : 'altro';

const terna = (v: number[]): Stats => ({ atk: v[0], def: v[1], sta: v[2] });

/** Legge i tre campi dell'infobox e li porta in una delle categorie (vedi l'intestazione del file). */
export function parseStatsDettaglio(wt: string): Dettaglio {
  const campo = (k: string): string | null => {
    const m = wt.match(new RegExp('\\|\\s*' + k + '\\s*=([^\\n|]*)', 'i'));
    return m ? m[1].trim() : null;
  };
  const grezzi = [campo('AttackStat'), campo('DefenseStat'), campo('StaminaStat')];
  const nessuno = (motivo: Motivo, g: string[]): Dettaglio => ({ motivo, stats: null, stati: null, grezzi: g });
  if (grezzi.some((g) => g === null || g === '')) return nessuno('vuoto', grezzi.map((g) => g ?? ''));
  const g = grezzi as string[];
  const classi = g.map(classificaCampo);
  const tutte = (c: Campo) => classi.every((x) => x === c);

  if (tutte('intero')) return { motivo: 'intero', stats: terna(g.map(Number)), stati: null, grezzi: g };
  if (tutte('slash') || tutte('freccia')) {
    const re = tutte('slash') ? RE_SLASH : RE_FRECCIA;
    const m = g.map((x) => x.match(re)!);
    return {
      motivo: tutte('slash') ? 'slash' : 'freccia',
      stats: null,
      stati: [terna(m.map((x) => +x[1])), terna(m.map((x) => +x[2]))],
      grezzi: g,
    };
  }
  if (tutte('prodotti')) {
    const m = g.map((x) => x.match(RE_PRODOTTI)!);
    return { motivo: 'prodotti', stats: terna(m.map((x) => +x[1])), stati: null, grezzi: g };
  }
  if (classi.every((c) => c === 'intero' || c === 'decimale')) return nessuno('decimale', g);
  return nessuno('altro', g);
}

export function parseStats(wt: string): Stats | null {
  return parseStatsDettaglio(wt).stats;
}

export interface Voce { title: string; det: Dettaglio }
export type MappaFamiglia = Map<string, Voce>;

export function buildMap(pages: Map<string, string>): MappaFamiglia {
  const map: MappaFamiglia = new Map();
  for (const [title, wt] of pages) map.set(norm(stripPrefix(title)), { title, det: parseStatsDettaglio(wt) });
  return map;
}

interface Riga { id: string; pagina: string; grezzi: string[] }
export interface Piano {
  guadagnano: { id: string; pagina: string; stats: Stats }[];
  cambiano: { id: string; pagina: string; vecchio: Stats; nuovo: Stats }[];
  /** Parti dell'elenco a due stati: `stats` = primo valore, `statsAlt` = secondo. */
  dueStati: { id: string; pagina: string; kind: 'mode' | 'shift'; labels?: [string, string]; primo: Stats; secondo: Stats; esito: 'nuovo' | 'cambia' | 'invariato' }[];
  /** Due valori sul wiki ma la parte non e' nell'elenco: non scritta. */
  dueValoriFuoriElenco: (Riga & { formato: 'slash' | 'freccia' })[];
  /** `55<br>60 (2.0)`: due prodotti, la parte tiene il primo valore come `stats`. */
  dueProdotti: (Riga & { stats: Stats })[];
  decimali: Riga[];
  altri: Riga[];
  ambigue: { id: string; pagine: string[] }[];
  invariate: number;
}

const stessi = (a: Stats, b: Stats) => a.atk === b.atk && a.def === b.def && a.sta === b.sta;
const stessoAlt = (a: StatsAlt, b: StatsAlt) =>
  a.kind === b.kind && stessi(a.stats, b.stats) && JSON.stringify(a.labels ?? null) === JSON.stringify(b.labels ?? null);

/** Imposta `statsAlt` subito dopo `stats` nell'oggetto, cosi' nel master le due chiavi stanno vicine. */
function impostaAlt(p: any, alt: StatsAlt) {
  if ('statsAlt' in p) { p.statsAlt = alt; return; }
  const voci = Object.entries(p);
  for (const k of Object.keys(p)) delete p[k];
  for (const [k, v] of voci) { p[k] = v; if (k === 'stats') p.statsAlt = alt; }
  if (!('statsAlt' in p)) p.statsAlt = alt;
}

/**
 * Calcola cosa cambierebbe in una lista del master; con `applica` scrive `stats` (e `statsAlt`) sulle parti.
 * `elenco` = le parti a due stati di QUESTA lista. Solleva un errore (prima di qualunque scrittura del
 * file) se una parte dell'elenco non e' nel master, non ha pagina sul wiki o non ha piu' due valori.
 */
export function pianifica(parts: any[] | undefined, famiglie: MappaFamiglia[], applica: boolean, elenco: VoceDueStati[] = []): Piano {
  const piano: Piano = {
    guadagnano: [], cambiano: [], dueStati: [], dueValoriFuoriElenco: [], dueProdotti: [],
    decimali: [], altri: [], ambigue: [], invariate: 0,
  };
  const viste = new Set<string>();

  const scriviStats = (p: any, pagina: string, nuovo: Stats) => {
    const vecchio: Stats | undefined = p.stats;
    if (!vecchio) piano.guadagnano.push({ id: p.id, pagina, stats: nuovo });
    else if (!stessi(vecchio, nuovo)) piano.cambiano.push({ id: p.id, pagina, vecchio, nuovo });
    else piano.invariate++;
    if (applica) p.stats = nuovo;
  };

  for (const p of parts ?? []) {
    const keys = [norm(p.names?.tt), norm(p.names?.hasbro), norm(p.id)].filter(Boolean);
    const trovate: Voce[] = [];
    for (const f of famiglie) {
      const k = keys.find((x) => f.has(x));
      if (k) trovate.push(f.get(k)!);
    }
    const inElenco = elenco.find((e) => e.id === p.id);
    if (!trovate.length) continue;
    if (inElenco) viste.add(p.id);

    if (inElenco) {
      const due = trovate.filter((v) => v.det.stati);
      if (!due.length) {
        throw new Error(
          `${p.id} e' nell'elenco delle parti a due stati (data/parts-due-stati.json) ma sul wiki ` +
          `(${trovate.map((v) => `${v.title}: ${v.det.grezzi.join(' ; ')}`).join(' | ')}) il formato non e' piu' a due valori: ` +
          `nessuna scrittura. Rileggere la pagina e aggiornare l'elenco o lo script.`,
        );
      }
      const [primo, secondo] = due[0].det.stati!;
      if (due.some((v) => !stessi(v.det.stati![0], primo) || !stessi(v.det.stati![1], secondo))) {
        piano.ambigue.push({ id: p.id, pagine: due.map((v) => v.title) });
        continue;
      }
      scriviStats(p, due[0].title, primo);
      const alt: StatsAlt = { kind: inElenco.kind, stats: secondo, ...(inElenco.labels ? { labels: inElenco.labels } : {}) };
      const esito = !p.statsAlt ? 'nuovo' : stessoAlt(p.statsAlt, alt) ? 'invariato' : 'cambia';
      piano.dueStati.push({ id: p.id, pagina: due[0].title, kind: alt.kind, labels: alt.labels, primo, secondo, esito });
      if (applica) impostaAlt(p, alt);
      continue;
    }

    const ok = trovate.filter((v) => v.det.stats);
    if (ok.length > 1 && ok.some((v) => !stessi(v.det.stats!, ok[0].det.stats!))) {
      piano.ambigue.push({ id: p.id, pagine: ok.map((v) => v.title) });
      continue;
    }
    if (!ok.length) {
      const due = trovate.find((v) => v.det.stati);
      const dec = trovate.find((v) => v.det.motivo === 'decimale');
      const altro = trovate.find((v) => v.det.motivo === 'altro');
      if (due) {
        piano.dueValoriFuoriElenco.push({ id: p.id, pagina: due.title, grezzi: due.det.grezzi, formato: due.det.motivo as 'slash' | 'freccia' });
      } else if (dec) piano.decimali.push({ id: p.id, pagina: dec.title, grezzi: dec.det.grezzi });
      else if (altro) piano.altri.push({ id: p.id, pagina: altro.title, grezzi: altro.det.grezzi });
      continue;
    }
    const v = ok[0];
    if (v.det.motivo === 'prodotti') piano.dueProdotti.push({ id: p.id, pagina: v.title, grezzi: v.det.grezzi, stats: v.det.stats! });
    scriviStats(p, v.title, v.det.stats!);
  }

  for (const e of elenco) {
    if (!viste.has(e.id)) {
      throw new Error(`${e.lista}/${e.id} e' nell'elenco delle parti a due stati ma non ha una pagina sul wiki abbinata (o non e' nel master): nessuna scrittura.`);
    }
  }
  return piano;
}

/** Legge e controlla data/parts-due-stati.json (lista, id, kind, labels opzionali). */
export function leggiDueStati(testo: string): VoceDueStati[] {
  const arr = JSON.parse(testo);
  if (!Array.isArray(arr)) throw new Error('parts-due-stati.json: atteso un array');
  const visti = new Set<string>();
  return arr.map((e: any, i: number) => {
    const dove = `parts-due-stati.json[${i}]`;
    if (typeof e?.lista !== 'string' || !(e.lista in SORGENTI)) throw new Error(`${dove}: lista non valida`);
    if (typeof e.id !== 'string' || !e.id) throw new Error(`${dove}: id mancante`);
    if (e.kind !== 'mode' && e.kind !== 'shift') throw new Error(`${dove}: kind deve essere mode o shift`);
    if (e.labels !== undefined && !(Array.isArray(e.labels) && e.labels.length === 2 && e.labels.every((l: any) => typeof l === 'string' && l))) {
      throw new Error(`${dove}: labels deve essere [primo, secondo]`);
    }
    const k = `${e.lista}/${e.id}`;
    if (visti.has(k)) throw new Error(`${dove}: ${k} duplicato`);
    visti.add(k);
    return { lista: e.lista, id: e.id, kind: e.kind, ...(e.labels ? { labels: e.labels } : {}) } as VoceDueStati;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet(params: Record<string, string>): Promise<any> {
  const u = new URL(API);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('format', 'json');
  const res = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${u}`);
  return res.json();
}

async function catTitles(cat: string): Promise<string[]> {
  const out: string[] = [];
  let cont: string | undefined;
  do {
    const p: Record<string, string> = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${cat}`,
      cmlimit: '500',
      cmprop: 'title',
      cmnamespace: '0',
    };
    if (cont) p.cmcontinue = cont;
    const j = await apiGet(p);
    for (const m of j.query?.categorymembers ?? []) out.push(m.title);
    cont = j.continue?.cmcontinue;
    await sleep(1000);
  } while (cont);
  return out;
}

async function fetchContents(titles: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const j = await apiGet({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: batch.join('|'),
    });
    const pages = j.query?.pages ?? {};
    for (const k of Object.keys(pages)) {
      const pg = pages[k];
      const rev = pg?.revisions?.[0];
      const content = rev?.slots?.main?.['*'] ?? rev?.['*'];
      if (pg?.title && content) map.set(pg.title, content);
    }
    await sleep(1000);
  }
  return map;
}

async function famiglia(cat: string): Promise<MappaFamiglia> {
  const titles = await catTitles(cat);
  const map = buildMap(await fetchContents(titles));
  const conStat = [...map.values()].filter((v) => v.det.motivo === 'intero').length;
  console.log(`[${cat}] ${titles.length} pagine, ${conStat} con stat intere (ATK/DEF/STA)`);
  return map;
}

const fmt = (s: Stats) => `${s.atk}/${s.def}/${s.sta}`;

async function main() {
  const dry = process.argv.includes('--dry');
  const master = JSON.parse(readFileSync(masterPath, 'utf8'));
  const elenco = leggiDueStati(readFileSync(dueStatiPath, 'utf8'));

  const piani: Record<string, Piano> = {};
  const famiglie: Record<string, MappaFamiglia[]> = {};
  for (const [lista, cats] of Object.entries(SORGENTI)) {
    famiglie[lista] = [];
    for (const [i, cat] of cats.entries()) {
      const m = await famiglia(cat);
      // La categoria principale vuota vuol dire wiki rotto o categoria rinominata: meglio fermarsi.
      if (i === 0 && m.size === 0) throw new Error(`categoria ${cat} vuota: nessuna scrittura`);
      famiglie[lista].push(m);
    }
  }
  // pianifica solleva (prima di scrivere il file) se una parte a due stati non ha piu' due valori sul wiki.
  for (const lista of Object.keys(SORGENTI)) {
    piani[lista] = pianifica(master[lista], famiglie[lista], !dry, elenco.filter((e) => e.lista === lista));
  }

  if (!dry) {
    const tmp = masterPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(master, null, 2) + '\n');
    renameSync(tmp, masterPath);
  }

  const tutte = <K extends keyof Piano>(k: K) =>
    Object.entries(piani).flatMap(([lista, p]) => (p[k] as any[]).map((x) => ({ lista, ...x })));
  const g = tutte('guadagnano'), c = tutte('cambiano'), ds = tutte('dueStati');
  const fe = tutte('dueValoriFuoriElenco'), dp = tutte('dueProdotti'), dc = tutte('decimali'), al = tutte('altri'), a = tutte('ambigue');

  console.log(`\n=== ${dry ? 'DRY RUN: nessuna scrittura' : 'Stat applicate al master'} ===`);
  console.log(`\nParti che guadagnano le statistiche: ${g.length}`);
  for (const x of g) console.log(`  ${x.lista}/${x.id}  ${fmt(x.stats)}  (${x.pagina})`);
  console.log(`\nParti che cambiano valore: ${c.length}`);
  for (const x of c) console.log(`  ${x.lista}/${x.id}  ${fmt(x.vecchio)} -> ${fmt(x.nuovo)}  (${x.pagina})`);
  console.log(`\nParti a due stati (elenco data/parts-due-stati.json): ${ds.length}`);
  for (const x of ds) {
    console.log(`  ${x.lista}/${x.id}  ${x.kind}  stats ${fmt(x.primo)}  statsAlt ${fmt(x.secondo)}${x.labels ? `  labels ${x.labels.join(' / ')}` : ''}  [statsAlt ${x.esito}]  (${x.pagina})`);
  }
  console.log(`\nDue valori, non in elenco (non scritti, li decide una persona): ${fe.length}`);
  for (const x of fe) console.log(`  ${x.lista}/${x.id}  ${x.formato === 'slash' ? 'con /' : 'con >'}  ${x.grezzi.join(' ; ')}  (${x.pagina})`);
  console.log(`\nDue prodotti (originale e 2.0): stats = primo valore, nessun statsAlt: ${dp.length}`);
  for (const x of dp) console.log(`  ${x.lista}/${x.id}  ${fmt(x.stats)}  da ${x.grezzi.join(' ; ')}  (${x.pagina})`);
  console.log(`\nDecimali, non applicati: ${dc.length}`);
  for (const x of dc) console.log(`  ${x.lista}/${x.id}  ${x.grezzi.join(' ; ')}  (${x.pagina})`);
  console.log(`\nAltro formato, non applicato: ${al.length}`);
  for (const x of al) console.log(`  ${x.lista}/${x.id}  ${x.grezzi.join(' ; ')}  (${x.pagina})`);
  if (a.length) {
    console.log(`\nParti ambigue (famiglie con valori diversi), non toccate: ${a.length}`);
    for (const x of a) console.log(`  ${x.lista}/${x.id}  ${x.pagine.join(' | ')}`);
  }
  console.log(`\nInvariate (stessi valori): ${Object.values(piani).reduce((n, p) => n + p.invariate, 0)}`);
  if (!dry) console.log('\nOra esegui: npm run build:parts');
}

// Esegui solo come entry-point: l'import dal test NON deve innescare main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`[enrich-stats] ERRORE: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
