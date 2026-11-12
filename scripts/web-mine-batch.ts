/**
 * web-mine-batch.ts — Serve all'estrazione combo le pagine web cambiate dall'ultima lettura.
 *
 * Stesso schema di youtube-mine-batch.ts. `fetch-web.ts` scarica le pagine e ne calcola l'impronta
 * in `data/web-cache.json`; qui una pagina è «da leggere» quando la sua impronta è diversa da quella
 * registrata in `data/web-mined.json`. L'IA (/mine-web) dice quali combo complete contiene, il
 * codice costruisce le mentions e le fonde col merge di Reddit.
 *
 * Le fonti web producono solo `mentions` (tier narrative), mai `placements`. Una pagina riletta
 * dopo un cambiamento non duplica le mentions già scritte: il merge le riconosce per fonte, tipo e
 * url.
 *
 * Uso:
 *   npx tsx scripts/web-mine-batch.ts next [--chars 150000]  → scrive il blocco e il dizionario parti
 *   npx tsx scripts/web-mine-batch.ts done                   → valida, fonde, registra le impronte
 *   npx tsx scripts/web-mine-batch.ts count                  → quante pagine restano da leggere
 *   npx tsx scripts/web-mine-batch.ts letti                  → quante letture sono state registrate in tutto
 *   npx tsx scripts/web-mine-batch.ts stats                  → per fonte: ultima lettura e combo trovate
 */
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { cutoffISO } from './lib/freshness';
import { mergeExtracted, type MergeFonte } from './reddit-merge';
import { scriviDizionario, chiaveCombo, voceDaFondere, readJson, today } from './lib/mine-comune';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'web-cache.json');
const MINED = join(ROOT, 'data', 'web-mined.json');
const BATCH = join(ROOT, 'tmp', 'web-mining-batch.json');
const DICT = join(ROOT, 'tmp', 'web-mining-parts.json');
const EXTRACTED = join(ROOT, 'tmp', 'web-extracted.json');

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const FONTE_WEB: MergeFonte = {
  source: 'web',
  sourceName: 'Web',
  sourceUrl: '',
  notes: 'Combo riportata da una fonte web.',
};

interface Pagina { url: string; sourceId: string; sourceName: string; lang: string; title: string; hash: string; text: string }

function pending(): Pagina[] {
  const pages = readJson(CACHE, { pages: {} }).pages ?? {};
  const mined = readJson(MINED, { pages: {} }).pages ?? {};
  const out: Pagina[] = [];
  for (const [url, p] of Object.entries<any>(pages)) {
    if (mined[url]?.hash === p.hash) continue;
    out.push({ url, sourceId: p.sourceId, sourceName: p.sourceName ?? p.sourceId, lang: p.lang ?? 'en', title: p.title ?? '', hash: p.hash, text: p.text });
  }
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

function cmdNext(maxChars: number) {
  const all = pending();
  const batch: Pagina[] = [];
  let chars = 0;
  for (const p of all) {
    if (batch.length && chars + p.text.length > maxChars) break;
    batch.push(p);
    chars += p.text.length;
  }
  mkdirSync(dirname(BATCH), { recursive: true });
  const batchId = randomBytes(6).toString('hex');
  writeFileSync(BATCH, JSON.stringify({ batchId, servedAt: today(), pages: batch }, null, 2));
  rmSync(EXTRACTED, { force: true });
  scriviDizionario(DICT);
  console.log(`Blocco ${batchId}: ${batch.length} pagine, ${chars} caratteri, in ${BATCH}`);
  console.log(`Dizionario parti in ${DICT}`);
  console.log(`Rimanenti dopo questo blocco: ${all.length - batch.length}`);
}

function fallisci(msg: string): never {
  console.error(`web-mine done RIFIUTATO: ${msg}`);
  console.error('Niente è stato fuso né registrato. Correggi tmp/web-extracted.json e rilancia done.');
  process.exit(1);
}

/** Data detta dal modello per una combo: vale solo se è una data vera, non futura. Altrimenti oggi. */
function dataValida(d: unknown): string | null {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(d);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) return null;
  return d <= today() ? d : null;
}

function cmdDone() {
  const batch = readJson(BATCH, null);
  if (!batch?.pages?.length) {
    console.log('Nessun blocco corrente da chiudere.');
    return;
  }
  const ex = readJson(EXTRACTED, null);
  if (!ex) fallisci(`manca ${EXTRACTED}`);
  if (ex.batchId !== batch.batchId) fallisci(`batchId "${ex.batchId}" diverso dal blocco servito "${batch.batchId}"`);
  if (!Array.isArray(ex.pages)) fallisci('atteso { batchId, pages: [{ url, combos: [...] }] }');

  const servite = new Map<string, Pagina>(batch.pages.map((p: Pagina) => [p.url, p]));
  const risposte = new Map<string, any>();
  for (const r of ex.pages) {
    if (!servite.has(r?.url)) fallisci(`url "${r?.url}" non fa parte del blocco servito`);
    if (!Array.isArray(r.combos)) fallisci(`pagina ${r.url}: "combos" deve essere un array, anche vuoto`);
    risposte.set(r.url, r);
  }
  const mancanti = [...servite.keys()].filter((u) => !risposte.has(u));
  if (mancanti.length) fallisci(`${mancanti.length} pagine del blocco senza risposta: ${mancanti.join(', ')}`);

  const limite = cutoffISO();
  const daFondere: any[] = [];
  const perPagina: Record<string, number> = {};
  let vecchie = 0;
  for (const [url, r] of risposte) {
    const p = servite.get(url)!;
    const viste = new Set<string>();
    for (const c of r.combos) {
      const chiave = chiaveCombo(c);
      if (viste.has(chiave)) continue;
      const date = dataValida(c.date) ?? today();
      if (date < limite) { vecchie++; continue; }   // un torneo più vecchio del cutoff non è evidenza fresca
      viste.add(chiave);
      // `source` è lo slug del nome, come lo calcola score-combos.ts dalle sources[] della combo:
      // con un valore diverso la stessa fonte conterebbe due volte nella corroboration.
      daFondere.push({ ...voceDaFondere(c, { source: slug(p.sourceName), sourceId: p.sourceId, url, lang: p.lang, date }), sourceName: p.sourceName });
    }
    perPagina[url] = viste.size;
  }

  const esito = daFondere.length ? mergeExtracted(daFondere, FONTE_WEB) : { created: 0, updated: 0, skipped: 0 };

  const mined = readJson(MINED, { pages: {}, letture: 0 });
  mined.pages = mined.pages ?? {};
  for (const [url, p] of servite) {
    mined.pages[url] = { sourceId: p.sourceId, hash: p.hash, minedDate: today(), combosFound: perPagina[url] ?? 0 };
  }
  mined.letture = (mined.letture ?? 0) + servite.size;
  mined.lastRun = today();
  writeFileSync(MINED, JSON.stringify(mined, null, 2));
  rmSync(EXTRACTED, { force: true });
  rmSync(BATCH, { force: true });

  console.log(`Blocco ${batch.batchId} chiuso: ${servite.size} pagine lette, ${daFondere.length} menzioni proposte, ${vecchie} scartate perché più vecchie del cutoff.`);
  console.log(`Merge: ${esito.created} combo nuove, ${esito.updated} aggiornate, ${esito.skipped} scartate dal registro.`);
  console.log(`Rimanenti: ${pending().length}`);
}

function cmdStats() {
  const mined = readJson(MINED, { pages: {} }).pages ?? {};
  const cache = readJson(CACHE, { pages: {} }).pages ?? {};
  console.log('fonte'.padEnd(26) + 'letta il    combo  pagina');
  for (const url of Object.keys(cache).sort()) {
    const m = mined[url];
    console.log(String(cache[url].sourceId).padEnd(26) + String(m?.minedDate ?? 'mai').padEnd(12) + String(m?.combosFound ?? 0).padStart(5) + '  ' + url);
  }
  console.log(`Da leggere: ${pending().length}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'next') {
  const i = rest.indexOf('--chars');
  cmdNext(i >= 0 ? parseInt(rest[i + 1], 10) || 150_000 : 150_000);
} else if (cmd === 'done') {
  cmdDone();
} else if (cmd === 'count') {
  console.log(String(pending().length));
} else if (cmd === 'letti') {
  // Letture registrate in tutto: i .bat lo confrontano prima e dopo lo step per sapere se ha lavorato.
  console.log(String(readJson(MINED, { letture: 0 }).letture ?? 0));
} else if (cmd === 'stats') {
  cmdStats();
} else {
  console.error('Uso: web-mine-batch.ts next [--chars N] | done | count | letti | stats');
  process.exit(1);
}
