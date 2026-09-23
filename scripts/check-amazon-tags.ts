/**
 * check-amazon-tags.ts — ogni tracking ID di data/amazon-config.json deve stare nell'HTML generato,
 * su ogni pagina, per chiunque la scarichi.
 * Esegui dopo la build: npm run test:amazon-tags (esce 1 se un controllo fallisce). Gira anche nel
 * workflow di deploy, fra la build e la pubblicazione: una pagina che lo viola non va online.
 *
 * Perché: Amazon Francia ha respinto la candidatura (21/09/2026) e poi il ricorso (23/09) perché sul
 * sito non trovava link col tag francese. Il tag c'era, ma lo scriveva lo script solo dopo aver
 * rilevato un visitatore in Francia; l'HTML servito conteneva soltanto link amazon.com col tag US.
 * Un revisore da un altro paese, o un crawler che non esegue JavaScript, non poteva vederlo. Qui si
 * legge l'HTML come lo legge lui: file per file, senza browser.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '..');
// Un'altra cartella come argomento: per esempio le pagine scaricate dal sito pubblicato.
const DIST = process.argv[2] ?? join(ROOT, 'dist');
const config = JSON.parse(readFileSync(join(ROOT, 'data', 'amazon-config.json'), 'utf8')) as {
  marketplaces: Record<string, { tld: string; tag: string }>;
};
const markets = Object.entries(config.marketplaces);
const tagOfTld = new Map(markets.map(([, m]) => [m.tld, m.tag]));

let failed = 0;
function ko(msg: string) { console.error(`  KO ${msg}`); failed++; }

if (!existsSync(DIST)) { console.error('dist/ non esiste: lanciare prima npm run build'); process.exit(1); }

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return name.endsWith('.html') ? [p] : [];
  });
}

const files = htmlFiles(DIST);
let links = 0;
let buyBlocks = 0;
for (const file of files) {
  const rel = relative(DIST, file).replace(/\\/g, '/');
  const html = readFileSync(file, 'utf8');
  const hrefs = [...html.matchAll(/href="(https:\/\/www\.(amazon\.[a-z.]+)\/[^"]*)"/g)]
    .map((m) => ({ href: m[1].replace(/&amp;/g, '&'), tld: m[2] }));
  links += hrefs.length;

  // 1. Ogni tag su ogni pagina (li porta il footer).
  for (const [market, m] of markets) {
    if (!hrefs.some((h) => h.href.includes(`tag=${m.tag}`))) ko(`${rel}: manca il tag ${market} (${m.tag})`);
  }
  // 2. Ogni link porta il tag del proprio negozio: un tag francese su amazon.de non paga nessuno.
  for (const h of hrefs) {
    const tag = h.href.match(/[?&]tag=([^&]+)/)?.[1];
    const atteso = tagOfTld.get(h.tld);
    if (!atteso) ko(`${rel}: negozio fuori config ${h.href}`);
    else if (tag !== atteso) ko(`${rel}: ${h.href} ha tag ${tag ?? 'nessuno'}, atteso ${atteso}`);
  }
  // 3. Ogni riga «Where to buy» ha il link al prodotto su tutti i negozi, non solo la ricerca del footer.
  for (const m of html.matchAll(/data-testid="buy-part-stores"[^>]*>([\s\S]*?)<\/p>/g)) {
    buyBlocks++;
    for (const [market, mk] of markets) {
      if (!m[1].includes(`www.${mk.tld}/`)) ko(`${rel}: una riga Where to buy non ha il negozio ${market}`);
    }
  }
}

console.log(`${files.length} pagine, ${links} link Amazon, ${buyBlocks} righe Where to buy, ${markets.length} negozi`);
if (files.length === 0) ko('nessuna pagina HTML in dist/');
if (buyBlocks === 0) ko('nessuna riga Where to buy: il selettore data-testid="buy-part-stores" non trova più niente');
if (failed) { console.error(`${failed} controlli falliti`); process.exit(1); }
console.log(`OK: ogni tag è nell'HTML di ogni pagina`);
