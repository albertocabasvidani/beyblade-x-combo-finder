/**
 * sync-part-images.ts — Immagini dei componenti dalla Beyblade Fandom Wiki.
 *
 * Input:  data/parts-master.json (277 parti in 7 array) + data/image-overrides.json (opzionale)
 * Output: public/images/parts/<id>.png (cartella piatta, gli id sono unici cross-categoria)
 *         + campo `image: { file, wikiFile, fetchedAt }` scritto sulla parte nel master.
 *
 * Deterministico, niente IA: gira sul homeserver via dispatcher come /update-parts.
 * MAI WebFetch sulle pagine /wiki/ (risponde 402 in questo ambiente): tutto passa dall'API
 * MediaWiki (https://beyblade.fandom.com/api.php), via lib/wiki.ts (stesso client di
 * scan-wiki-updates.ts, con retry e sleep gia' collaudati).
 *
 * Algoritmo di match parte -> pagina wiki e catena di fallback per l'immagine: validati a mano
 * il 19/08/2026 (269/277 pagine trovate, 246/261 con pageimages diretto). Stesso approccio di
 * `c:\claude-code\Personale\Beyblade\bbxdeckbuild\scripts\sync-parts.js` per il parsing
 * dell'infobox — consultarlo in caso di dubbi.
 *
 * Idempotenza: una parte con `public/images/parts/<id>.png` gia' su disco non viene ritoccata
 * (si assicura solo che il master abbia `image.file`). `--force <id>` forza il ri-download di
 * UNA parte sola. Mai silenzioso: exit 0 anche con parti mancanti, ma il report a stampa elenca
 * sempre chi manca e perche' — la pipeline giornaliera non deve bloccarsi su un download fallito.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { apiGet, sleep, readJson, today } from './lib/wiki';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const MASTER_PATH = join(DATA, 'parts-master.json');
const OVERRIDES_PATH = join(DATA, 'image-overrides.json');
const IMAGES_DIR = join(ROOT, 'public', 'images', 'parts');

const DELAY_MS = 300;
const IMAGE_UA = 'beyblade-combo-finder-images/1.0';

type Names = { tt: string; hasbro?: string | null };
type Alias = { value: string; kind?: string };
interface ImageMeta {
  file?: string;
  wikiFile?: string;
  fetchedAt?: string;
}
interface MasterPart {
  id: string;
  names: Names;
  aliases?: Alias[];
  source?: { page?: string };
  image?: ImageMeta;
}
interface Master {
  blades?: MasterPart[];
  lockChips?: MasterPart[];
  mainBlades?: MasterPart[];
  assistBlades?: MasterPart[];
  overBlades?: MasterPart[];
  ratchets?: MasterPart[];
  bits?: MasterPart[];
  [k: string]: unknown;
}

type Category = 'blades' | 'lockChips' | 'mainBlades' | 'assistBlades' | 'overBlades' | 'ratchets' | 'bits';

// Prefissi delle pagine wiki per categoria (spazio-trattino-spazio esatto, verificato 19/08/2026).
const CATEGORY_PREFIXES: Record<Category, string[]> = {
  blades: ['Blade - ', 'Ratchet-Integrated Blade - '],
  lockChips: ['Lock Chip - '],
  mainBlades: ['Main Blade - '],
  assistBlades: ['Assist Blade - '],
  overBlades: ['Over Blade - '],
  ratchets: ['Ratchet - '],
  bits: ['Bit - ', 'Ratchet-Integrated Bit - '],
};
const CATEGORY_ORDER: Category[] = [
  'blades', 'lockChips', 'mainBlades', 'assistBlades', 'overBlades', 'ratchets', 'bits',
];
const CATEGORY_LABEL: Record<Category, string> = {
  blades: 'BLADE', lockChips: 'LOCK CHIP', mainBlades: 'MAIN BLADE', assistBlades: 'ASSIST BLADE',
  overBlades: 'OVER BLADE', ratchets: 'RATCHET', bits: 'BIT',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// ---------- CLI ----------
const argv = process.argv.slice(2);
const forceFlagIdx = argv.indexOf('--force');
const forceId = forceFlagIdx >= 0 ? argv[forceFlagIdx + 1] : null;
if (forceFlagIdx >= 0 && !forceId) {
  console.error('Uso: npm run sync:part-images -- --force <id>');
  process.exit(1);
}

// ---------- Indice pagine wiki per categoria ----------

/** Lista pagine per un prefisso, paginata con apcontinue (limite API: 500 per chiamata). */
async function fetchAllPages(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let apcontinue: string | undefined;
  for (;;) {
    const params: Record<string, string> = {
      action: 'query', list: 'allpages', apprefix: prefix, aplimit: '500',
    };
    if (apcontinue) params.apcontinue = apcontinue;
    const j = await apiGet(params);
    await sleep(DELAY_MS);
    for (const p of j.query?.allpages ?? []) out.push(p.title as string);
    apcontinue = j.continue?.apcontinue;
    if (!apcontinue) break;
  }
  return out;
}

function setIfBetter(
  index: Map<string, string>, priority: Map<string, number>, key: string, title: string, prio: number,
) {
  if (!key) return;
  const cur = priority.get(key);
  if (cur === undefined || prio > cur) {
    priority.set(key, prio);
    index.set(key, title);
  }
}

/**
 * Indicizza le pagine di un prefisso: chiave = titolo senza prefisso, normalizzato.
 * Per i titoli con parentesi (varianti "(Takara Tomy)" / "(Hasbro)") indicizza anche la chiave
 * senza parentesi, preferendo la variante Takara Tomy in caso di collisione.
 */
function indexPages(prefix: string, titles: string[], index: Map<string, string>, priority: Map<string, number>) {
  for (const title of titles) {
    if (!title.startsWith(prefix)) continue;
    const suffix = title.slice(prefix.length);
    // chiave esatta (con l'eventuale parentesi): la piu' specifica, vince sempre
    setIfBetter(index, priority, norm(suffix), title, 3);
    const m = suffix.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m) {
      const base = m[1].trim();
      const parenContent = m[2].trim().toLowerCase();
      const prio = parenContent === 'hasbro' ? 0 : parenContent === 'takara tomy' ? 2 : 1;
      setIfBetter(index, priority, norm(base), title, prio);
    }
  }
}

async function buildIndexForCategory(cat: Category): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const priority = new Map<string, number>();
  for (const prefix of CATEGORY_PREFIXES[cat]) {
    const titles = await fetchAllPages(prefix);
    indexPages(prefix, titles, index, priority);
  }
  return index;
}

// ---------- Match parte -> pagina ----------

/**
 * Chiavi candidate della parte, in ordine: nome TT, nome Hasbro, id, alias non-nativi. Per ogni
 * candidata contenente una parentesi, prova anche il solo contenuto tra parentesi subito dopo.
 */
function candidateKeys(part: MasterPart): string[] {
  const raw: string[] = [];
  if (part.names?.tt) raw.push(part.names.tt);
  if (part.names?.hasbro) raw.push(part.names.hasbro);
  raw.push(part.id);
  for (const a of part.aliases ?? []) {
    if (a.kind !== 'native' && a.value) raw.push(a.value);
  }
  const keys: string[] = [];
  for (const r of raw) {
    keys.push(norm(r));
    const m = r.match(/\(([^()]*)\)/);
    if (m) keys.push(norm(m[1]));
  }
  return keys;
}

function matchPage(part: MasterPart, index: Map<string, string>): string | null {
  for (const k of candidateKeys(part)) {
    const title = index.get(k);
    if (title) return title;
  }
  return null;
}

// ---------- Risoluzione URL immagine ----------

/** Nome file dall'URL immagine (per il campo wikiFile del master). */
function extractFilename(url: string): string | undefined {
  const m = url.match(/\/([^/]+\.(?:png|jpg|jpeg|gif|webp))(?:[/?]|$)/i);
  return m ? decodeURIComponent(m[1]) : undefined;
}

async function resolveFileTitleToUrl(fileTitle: string): Promise<string | null> {
  const title = fileTitle.startsWith('File:') ? fileTitle : `File:${fileTitle}`;
  const j = await apiGet({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url' });
  await sleep(DELAY_MS);
  for (const p of Object.values<any>(j.query?.pages ?? {})) {
    if (p?.imageinfo?.[0]?.url) return p.imageinfo[0].url as string;
  }
  return null;
}

/** Passo 1: immagine principale della pagina (pageimages, con redirects=1). */
async function fromPageimages(title: string): Promise<string | null> {
  const j = await apiGet({ action: 'query', titles: title, prop: 'pageimages', piprop: 'original', redirects: '1' });
  await sleep(DELAY_MS);
  for (const p of Object.values<any>(j.query?.pages ?? {})) {
    if (p?.original?.source) return p.original.source as string;
  }
  return null;
}

/** Passo 2: campo `|image = ` dell'infobox nel wikitext della pagina. */
async function fromInfobox(title: string): Promise<string | null> {
  const j = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
  await sleep(DELAY_MS);
  const wt: string | undefined = j.parse?.wikitext?.['*'];
  if (!wt) return null;
  // Case-insensitive: il template Part Infobox usa `|Image=`, altre pagine `|image=`.
  const m = wt.match(/^\|\s*image\d*\s*=\s*(.+)$/im);
  if (!m) return null;
  const filename = m[1].replace(/<br\s*\/?>/gi, '|').split('|')[0].trim();
  if (!filename) return null;
  return resolveFileTitleToUrl(filename);
}

/** Passo 3: prima immagine PNG della pagina il cui nome contiene il nome della parte. */
async function fromImagesList(title: string, matchName: string): Promise<string | null> {
  const j = await apiGet({ action: 'query', titles: title, prop: 'images', imlimit: '50' });
  await sleep(DELAY_MS);
  const nkey = norm(matchName);
  for (const p of Object.values<any>(j.query?.pages ?? {})) {
    for (const im of p?.images ?? []) {
      const t: string = im.title ?? '';
      if (/\.png$/i.test(t) && norm(t).includes(nkey)) {
        return resolveFileTitleToUrl(t);
      }
    }
  }
  return null;
}

/** Override manuale: vince su tutto, va controllato per primo. */
async function fromOverride(part: MasterPart, overrides: Record<string, string>): Promise<string | null> {
  const val = overrides[part.id];
  if (!val) return null;
  return val.startsWith('File:') ? resolveFileTitleToUrl(val) : val;
}

interface Resolved { url: string; wikiFile?: string }

async function resolveImage(
  part: MasterPart, pageTitle: string | null, overrides: Record<string, string>,
): Promise<Resolved | null> {
  const ov = await fromOverride(part, overrides);
  if (ov) return { url: ov, wikiFile: extractFilename(ov) };

  if (pageTitle) {
    const u1 = await fromPageimages(pageTitle);
    if (u1) return { url: u1, wikiFile: extractFilename(u1) };
    const u2 = await fromInfobox(pageTitle);
    if (u2) return { url: u2, wikiFile: extractFilename(u2) };
    const u3 = await fromImagesList(pageTitle, part.names?.tt || part.id);
    if (u3) return { url: u3, wikiFile: extractFilename(u3) };
  }

  // Fallback pagina prodotto: unico modo per i main blade senza pagina componente dedicata.
  const productPage = part.source?.page;
  if (productPage) {
    const u4 = await fromPageimages(productPage);
    if (u4) return { url: u4, wikiFile: extractFilename(u4) };
  }
  return null;
}

// ---------- Download ----------
async function downloadImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': IMAGE_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- Elaborazione per categoria ----------
interface MissingEntry { id: string; reason: string; detail?: string }
interface CategoryReport { total: number; already: number; downloaded: number; missing: MissingEntry[] }

async function processCategory(
  cat: Category, parts: MasterPart[], overrides: Record<string, string>,
): Promise<CategoryReport> {
  const report: CategoryReport = { total: parts.length, already: 0, downloaded: 0, missing: [] };
  if (parts.length === 0) return report;

  console.log(`\n${CATEGORY_LABEL[cat]}: indicizzazione pagine wiki...`);
  const index = await buildIndexForCategory(cat);
  console.log(`  ${index.size} chiavi indicizzate, ${parts.length} parti da controllare`);

  for (const part of parts) {
    const destPath = join(IMAGES_DIR, `${part.id}.png`);
    const isForced = forceId === part.id;
    const alreadyOnDisk = existsSync(destPath) && !isForced;

    if (alreadyOnDisk) {
      if (!part.image?.file) {
        part.image = { ...(part.image ?? {}), file: `${part.id}.png` };
      }
      report.already++;
      continue;
    }

    try {
      const pageTitle = matchPage(part, index);
      const resolved = await resolveImage(part, pageTitle, overrides);
      if (!resolved) {
        const reason = pageTitle || part.source?.page ? 'pagina senza immagine risolvibile' : 'nessuna pagina';
        report.missing.push({ id: part.id, reason });
        continue;
      }
      const buffer = await downloadImageBuffer(resolved.url);
      await sleep(DELAY_MS);
      await sharp(buffer)
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .png()
        .toFile(destPath);
      part.image = { file: `${part.id}.png`, wikiFile: resolved.wikiFile, fetchedAt: today() };
      report.downloaded++;
    } catch (e) {
      report.missing.push({
        id: part.id, reason: 'download fallito', detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return report;
}

// ---------- Main ----------
async function main() {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const master: Master = JSON.parse(readFileSync(MASTER_PATH, 'utf8'));
  const overrides = readJson<Record<string, string>>(OVERRIDES_PATH, {});

  const before = JSON.stringify(master);

  const reports: Partial<Record<Category, CategoryReport>> = {};
  for (const cat of CATEGORY_ORDER) {
    const parts = (master[cat] as MasterPart[] | undefined) ?? [];
    reports[cat] = await processCategory(cat, parts, overrides);
  }

  const after = JSON.stringify(master);
  if (after !== before) {
    writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + '\n');
  }

  let totalAll = 0, alreadyAll = 0, downloadedAll = 0, missingAll = 0;
  console.log('\n=== Report sync-part-images ===');
  for (const cat of CATEGORY_ORDER) {
    const r = reports[cat]!;
    totalAll += r.total; alreadyAll += r.already; downloadedAll += r.downloaded; missingAll += r.missing.length;
    console.log(
      `${CATEGORY_LABEL[cat]}: ${r.total} totale / ${r.already} gia' presenti / ` +
      `${r.downloaded} scaricate ora / ${r.missing.length} MANCANTI`,
    );
    for (const m of r.missing) {
      console.log(`  - ${m.id}: ${m.reason}${m.detail ? ` (${m.detail})` : ''}`);
    }
  }
  console.log(
    `\nTOTALE: ${totalAll} parti / ${alreadyAll} gia' presenti / ` +
    `${downloadedAll} scaricate ora / ${missingAll} MANCANTI`,
  );
  console.log(missingAll === 0
    ? "Tutte le parti hanno un'immagine."
    : `${missingAll} parti restano senza immagine (vedi elenco sopra).`);
}

main().catch((e) => {
  console.error('ERRORE FATALE:', e);
  process.exit(1);
});
