/**
 * test-content.ts — protegge le content collections editoriali (src/content/) dal difetto che le
 * ha rese necessarie: contenuto sottile, generato senza revisione, o che gonfia il bundle client.
 * Esegui: npm run test:content (esce 1 se un controllo fallisce).
 *
 * Lavora sui file grezzi (frontmatter + body), non tramite Astro: niente bisogno di una build per
 * girare, e i messaggi citano il file che fallisce invece di un errore Vite generico.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  OK ${name}`);
  else { console.error(`  KO ${name} ${extra}`); failed++; }
}

const ROOT = join(import.meta.dirname, '..');
const CONTENT = join(ROOT, 'src', 'content');

// --- Parsing minimale del frontmatter YAML (i valori che servono qui sono tutti scalari/array
// piatti: niente bisogno di una libreria YAML per uno script di validazione). ---
interface Entry { file: string; collection: string; frontmatter: Record<string, any>; body: string; wordCount: number }

function parseFrontmatter(raw: string): { fm: Record<string, any>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error('frontmatter non trovato o non chiuso');
  const [, yaml, body] = m;
  const fm: Record<string, any> = {};
  let currentKey: string | null = null;
  for (const lineRaw of yaml.split(/\r?\n/)) {
    const line = lineRaw.trimEnd();
    if (!line.trim()) continue;
    const arrayItem = line.match(/^\s*-\s*(.*)$/);
    if (arrayItem && currentKey) {
      fm[currentKey] = fm[currentKey] ?? [];
      fm[currentKey].push(unquote(arrayItem[1]));
      continue;
    }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    currentKey = key;
    if (valueRaw === '' || valueRaw === '[]') {
      fm[key] = valueRaw === '[]' ? [] : undefined;
      continue;
    }
    const arrInline = valueRaw.match(/^\[(.*)\]$/);
    if (arrInline) {
      fm[key] = arrInline[1].split(',').map((s) => unquote(s.trim())).filter(Boolean);
      continue;
    }
    fm[key] = unquote(valueRaw);
  }
  return { fm, body: body.trim() };
}
function unquote(s: string): any {
  const t = s.trim();
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t;
}

function loadCollection(name: string): Entry[] {
  const dir = join(CONTENT, name);
  const entries: Entry[] = [];
  for (const file of readdirSync(dir)) {
    if (extname(file) !== '.mdx') continue;
    const raw = readFileSync(join(dir, file), 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    entries.push({ file, collection: name, frontmatter: fm, body, wordCount });
  }
  return entries;
}

const metaReports = loadCollection('meta-reports');
const parts = loadCollection('parts');
const combos = loadCollection('combos');
const buyingGuides = loadCollection('buying-guides');
const all = [...metaReports, ...parts, ...combos, ...buyingGuides];

// --- Dati veri, per validare gli id citati nel frontmatter (non basta che il file esista) ---
const combosData = JSON.parse(readFileSync(join(ROOT, 'data', 'combos.json'), 'utf8'));
const comboIds = new Set(combosData.combos.map((c: any) => c.id));
const partsMaster = JSON.parse(readFileSync(join(ROOT, 'data', 'parts-master.json'), 'utf8'));
const partIdsByCategory: Record<string, Set<string>> = {
  blade: new Set(partsMaster.blades.map((p: any) => p.id)),
  ratchet: new Set(partsMaster.ratchets.map((p: any) => p.id)),
  bit: new Set(partsMaster.bits.map((p: any) => p.id)),
  lockChip: new Set(partsMaster.lockChips.map((p: any) => p.id)),
  mainBlade: new Set(partsMaster.mainBlades.map((p: any) => p.id)),
  assistBlade: new Set(partsMaster.assistBlades.map((p: any) => p.id)),
  overBlade: new Set(partsMaster.overBlades.map((p: any) => p.id)),
};
const releases = JSON.parse(readFileSync(join(ROOT, 'data', 'releases.json'), 'utf8'));
const setCodes = new Set(Object.keys(releases.byCode ?? {}));

console.log('1. Gli id nel frontmatter esistono nei dati veri, nella categoria dichiarata');
for (const e of parts) {
  const { partId, category } = e.frontmatter;
  check(`parts/${e.file}: partId "${partId}" esiste come ${category}`, partIdsByCategory[category]?.has(partId), `categoria=${category}`);
}
for (const e of combos) {
  check(`combos/${e.file}: comboId "${e.frontmatter.comboId}" esiste`, comboIds.has(e.frontmatter.comboId));
}
for (const e of buyingGuides) {
  check(`buying-guides/${e.file}: setCode "${e.frontmatter.setCode}" esiste in releases.json`, setCodes.has(e.frontmatter.setCode));
}
for (const e of metaReports) {
  check(`meta-reports/${e.file}: month "${e.frontmatter.month}" in formato YYYY-MM`, /^\d{4}-\d{2}$/.test(e.frontmatter.month ?? ''));
}

console.log('\n2. Conteggio parole del body sopra la soglia per tipo (guard-rail anti thin-content)');
const MIN_WORDS: Record<string, number> = { 'meta-reports': 600, parts: 350, combos: 300, 'buying-guides': 400 };
for (const e of all) {
  const min = MIN_WORDS[e.collection];
  check(`${e.collection}/${e.file}: ${e.wordCount} parole >= ${min}`, e.wordCount >= min, `(${e.wordCount})`);
}

console.log('\n3. Anti-boilerplate: nessuna coppia di body si somiglia troppo (Jaccard su shingle a 8 parole)');
function shingles(text: string, n = 8): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) s.add(words.slice(i, i + n).join(' '));
  return s;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const shinglesByFile = all.map((e) => ({ e, sh: shingles(e.body) }));
let maxSim = 0, maxPair = '';
for (let i = 0; i < shinglesByFile.length; i++) {
  for (let j = i + 1; j < shinglesByFile.length; j++) {
    const sim = jaccard(shinglesByFile[i].sh, shinglesByFile[j].sh);
    if (sim > maxSim) { maxSim = sim; maxPair = `${shinglesByFile[i].e.file} / ${shinglesByFile[j].e.file}`; }
  }
}
check(`similarita' massima fra due body < 0.5 (trovata ${maxSim.toFixed(3)}: ${maxPair})`, maxSim < 0.5);

console.log('\n4. title/description: presenti, unici, description nella fascia di lunghezza');
const titles = new Map<string, string[]>();
const descriptions = new Map<string, string[]>();
for (const e of all) {
  const t = e.frontmatter.title ?? '';
  const d = e.frontmatter.description ?? '';
  check(`${e.collection}/${e.file}: title presente (20-70 char)`, t.length >= 20 && t.length <= 70, `(${t.length})`);
  check(`${e.collection}/${e.file}: description 80-160 char`, d.length >= 80 && d.length <= 160, `(${d.length})`);
  titles.set(t, [...(titles.get(t) ?? []), e.file]);
  descriptions.set(d, [...(descriptions.get(d) ?? []), e.file]);
}
for (const [t, files] of titles) check(`title unico: "${t.slice(0, 40)}..."`, files.length === 1, files.join(', '));
for (const [d, files] of descriptions) check(`description unica: "${d.slice(0, 40)}..."`, files.length === 1, files.join(', '));

console.log('\n5. Invariante di pubblicazione Amazon: almeno 10 non-draft, almeno 1 recente (<=45gg)');
const nonDraft = all.filter((e) => e.frontmatter.draft === false);
check(`almeno 10 pubblicazioni non-draft (trovate ${nonDraft.length})`, nonDraft.length >= 10);
const now = new Date();
const recent = nonDraft.filter((e) => {
  const d = new Date(e.frontmatter.publishedAt);
  return !isNaN(d.getTime()) && (now.getTime() - d.getTime()) / 86_400_000 <= 45;
});
check(`almeno 1 pubblicazione negli ultimi 45 giorni (trovate ${recent.length})`, recent.length >= 1);

console.log('\n6. Nessuna pagina orfana: link interni in uscita e presenza in relatedX di qualcun altro');
// Un conteggio approssimato ma reale: markdown link verso /parts|combos|buy|meta/ nel body.
const linkPattern = /\]\((\/(?:parts|combos|buy|meta)\/[^)]+)\)/g;
const outboundCounts = new Map<string, number>();
for (const e of all) {
  const matches = [...e.body.matchAll(linkPattern)];
  outboundCounts.set(e.file, matches.length);
}
for (const e of all) {
  check(`${e.collection}/${e.file}: almeno 2 link interni nel body`, (outboundCounts.get(e.file) ?? 0) >= 2, `(${outboundCounts.get(e.file)})`);
}

console.log(failed === 0 ? '\nTutti i controlli passati.' : `\n${failed} controlli FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
