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
 * NON tocca i comandi agentici daily. Scrive `stats: {atk,def,sta}` dentro data/parts-master.json
 * (merge-master preserva i campi extra → sopravvivono ai run giornalieri). Poi `npm run build:parts`
 * propaga le stat in parts.json (pass-through già presente in build-parts.ts).
 *
 * Le stat si impostano solo quando TUTTE e 3 sono interi puri nell'infobox. Un valore a due modalita'
 * (`50/70`, `30 > 55`) lascia la parte senza stat e finisce nell'elenco «valori a due modalita', non
 * applicati»: come rappresentarlo lo decide una persona. Un campo vuoto = nessun dato sul wiki.
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
const API = 'https://beyblade.fandom.com/api.php';
const UA = 'beyblade-x-combo-finder stats-enrichment';

export interface Stats { atk: number; def: number; sta: number }
export type Motivo = 'ok' | 'vuoto' | 'duemodalita';
export interface Dettaglio { motivo: Motivo; stats: Stats | null; grezzi: string[] }

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

/** Legge i tre campi dell'infobox: intero puro → ok; vuoti → vuoto; qualunque altra cosa con cifre → due modalita'. */
export function parseStatsDettaglio(wt: string): Dettaglio {
  const campo = (k: string): string | null => {
    const m = wt.match(new RegExp('\\|\\s*' + k + '\\s*=([^\\n|]*)', 'i'));
    return m ? m[1].trim() : null;
  };
  const grezzi = [campo('AttackStat'), campo('DefenseStat'), campo('StaminaStat')];
  if (grezzi.some((g) => g === null || g === '')) return { motivo: 'vuoto', stats: null, grezzi: grezzi.map((g) => g ?? '') };
  const g = grezzi as string[];
  if (g.every((x) => /^\d+$/.test(x))) {
    return { motivo: 'ok', stats: { atk: +g[0], def: +g[1], sta: +g[2] }, grezzi: g };
  }
  return { motivo: 'duemodalita', stats: null, grezzi: g };
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

export interface Piano {
  guadagnano: { id: string; pagina: string; stats: Stats }[];
  cambiano: { id: string; pagina: string; vecchio: Stats; nuovo: Stats }[];
  duemodalita: { id: string; pagina: string; grezzi: string[] }[];
  ambigue: { id: string; pagine: string[] }[];
  invariate: number;
}

const stessi = (a: Stats, b: Stats) => a.atk === b.atk && a.def === b.def && a.sta === b.sta;

/** Calcola cosa cambierebbe in una lista del master; con `applica` scrive `stats` sulle parti. */
export function pianifica(parts: any[] | undefined, famiglie: MappaFamiglia[], applica: boolean): Piano {
  const piano: Piano = { guadagnano: [], cambiano: [], duemodalita: [], ambigue: [], invariate: 0 };
  for (const p of parts ?? []) {
    const keys = [norm(p.names?.tt), norm(p.names?.hasbro), norm(p.id)].filter(Boolean);
    const trovate: Voce[] = [];
    for (const f of famiglie) {
      const k = keys.find((x) => f.has(x));
      if (k) trovate.push(f.get(k)!);
    }
    if (!trovate.length) continue;
    const ok = trovate.filter((v) => v.det.motivo === 'ok');
    const due = trovate.find((v) => v.det.motivo === 'duemodalita');
    if (ok.length > 1 && ok.some((v) => !stessi(v.det.stats!, ok[0].det.stats!))) {
      piano.ambigue.push({ id: p.id, pagine: ok.map((v) => v.title) });
      continue;
    }
    if (!ok.length) {
      if (due) piano.duemodalita.push({ id: p.id, pagina: due.title, grezzi: due.det.grezzi });
      continue;
    }
    const nuovo = ok[0].det.stats!;
    const vecchio: Stats | undefined = p.stats;
    if (!vecchio) piano.guadagnano.push({ id: p.id, pagina: ok[0].title, stats: nuovo });
    else if (!stessi(vecchio, nuovo)) piano.cambiano.push({ id: p.id, pagina: ok[0].title, vecchio, nuovo });
    else piano.invariate++;
    if (applica) p.stats = nuovo;
  }
  return piano;
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
  const conStat = [...map.values()].filter((v) => v.det.motivo === 'ok').length;
  console.log(`[${cat}] ${titles.length} pagine, ${conStat} con stat complete (ATK/DEF/STA)`);
  return map;
}

const fmt = (s: Stats) => `${s.atk}/${s.def}/${s.sta}`;

async function main() {
  const dry = process.argv.includes('--dry');
  const master = JSON.parse(readFileSync(masterPath, 'utf8'));

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
  for (const lista of Object.keys(SORGENTI)) piani[lista] = pianifica(master[lista], famiglie[lista], !dry);

  if (!dry) {
    const tmp = masterPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(master, null, 2) + '\n');
    renameSync(tmp, masterPath);
  }

  const tutte = <K extends keyof Piano>(k: K) =>
    Object.entries(piani).flatMap(([lista, p]) => (p[k] as any[]).map((x) => ({ lista, ...x })));
  const g = tutte('guadagnano'), c = tutte('cambiano'), d = tutte('duemodalita'), a = tutte('ambigue');

  console.log(`\n=== ${dry ? 'DRY RUN: nessuna scrittura' : 'Stat applicate al master'} ===`);
  console.log(`\nParti che guadagnano le statistiche: ${g.length}`);
  for (const x of g) console.log(`  ${x.lista}/${x.id}  ${fmt(x.stats)}  (${x.pagina})`);
  console.log(`\nParti che cambiano valore: ${c.length}`);
  for (const x of c) console.log(`  ${x.lista}/${x.id}  ${fmt(x.vecchio)} -> ${fmt(x.nuovo)}  (${x.pagina})`);
  console.log(`\nValori a due modalita', non applicati: ${d.length}`);
  for (const x of d) console.log(`  ${x.lista}/${x.id}  ${x.grezzi.join(' ; ')}  (${x.pagina})`);
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
