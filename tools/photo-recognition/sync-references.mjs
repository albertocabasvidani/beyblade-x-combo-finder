/** Cache versionata delle fonti prodotto e delle immagini reali (nessuna immagine anime). */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dir = join(root, 'data/recognition');
const manifest = JSON.parse(readFileSync(join(dir, 'visual-variants.json'), 'utf8'));
const api = 'https://beyblade.fandom.com/api.php';
const pause = () => new Promise(r => setTimeout(r, 350));
async function get(params) {
  const url = new URL(api);
  for (const [k, v] of Object.entries({ ...params, format: 'json' })) url.searchParams.set(k, v);
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Wiki HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  await pause();
  return j;
}
const only = process.argv.indexOf('--only');
const wanted = only >= 0 ? process.argv[only + 1] : null;
mkdirSync(join(dir, 'sources'), { recursive: true });
mkdirSync(join(dir, 'images'), { recursive: true });
for (const v of manifest.variants.filter(v => !wanted || v.id === wanted)) {
  const target = join(dir, `sources/${v.id}.json`);
  const previous = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
  const q = await get({ action: 'query', titles: v.assembly, redirects: '1', prop: 'revisions', rvprop: 'ids|timestamp' });
  const pg = Object.values(q.query?.pages ?? {})[0];
  const rev = pg?.revisions?.[0];
  if (!rev) throw new Error(`Pagina assente: ${v.assembly}`);
  const parsed = await get({ action: 'parse', oldid: String(rev.revid), prop: 'wikitext' });
  const wt = parsed.parse?.wikitext?.['*'];
  if (typeof wt !== 'string') throw new Error(`Wikitext assente: ${v.assembly}`);
  // Image1 è il prodotto: Image2/Image3 possono essere illustrazioni anime/manga.
  const field = wt.match(/\|\s*Image1?\s*=([\s\S]*?)(?=\n\|)/i)?.[1] ?? '';
  const names = field.includes('<gallery')
    ? [...field.matchAll(/^\s*([^<>\n|]+\.(?:png|jpe?g|webp))(?:\|[^\n]*)?\s*$/gmi)].map(m => m[1].trim())
    : [field.replace(/\[\[(?:File|Image):/i, '').split('|')[0].replace(/\]\]/g, '').trim()].filter(Boolean);
  const images = [];
  for (const [i, name] of names.entries()) {
    const meta = await get({ action: 'query', titles: `File:${name}`, prop: 'imageinfo', iiprop: 'url|extmetadata' });
    const info = Object.values(meta.query?.pages ?? {})[0]?.imageinfo?.[0];
    if (!info?.url) {
      images.push({ file: null, wikiFile: name, downloadError: 'File wiki non risolto' });
      continue;
    }
    const cached = previous?.images.find(p => p.wikiFile === name && p.url === info.url && p.file
      && existsSync(join(dir, p.file)) && createHash('sha256').update(readFileSync(join(dir, p.file))).digest('hex') === p.sha256);
    if (cached) { images.push(cached); continue; }
    // Il CDN con /revision/latest può rispondere 403 mentre il medesimo file base è pubblico.
    const downloadUrl = info.url.replace(/\/revision\/.*$/, '');
    const response = await fetch(downloadUrl, { headers: { 'User-Agent': 'beyblade-combo-finder-images/1.0' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      images.push({ file: null, wikiFile: name, url: info.url, descriptionUrl: info.descriptionurl,
        downloadError: `HTTP ${response.status}`, attribution: info.extmetadata ?? {} });
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type')?.split(';')[0];
    const ext = ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' })[mimeType];
    if (!ext) throw new Error(`Tipo immagine inatteso: ${mimeType}`);
    const local = `images/${v.id}-${i + 1}.${ext.toLowerCase()}`;
    writeFileSync(join(dir, local), bytes);
    images.push({ file: local, wikiFile: name, url: info.url, downloadUrl, mimeType, descriptionUrl: info.descriptionurl,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      attribution: info.extmetadata ?? {} });
  }
  const snapshot = { title: pg.title, revid: rev.revid, timestamp: rev.timestamp,
    fetchedAt: new Date().toISOString(), url: `https://beyblade.fandom.com/wiki/${encodeURI(pg.title.replaceAll(' ', '_'))}`,
    revisionUrl: `https://beyblade.fandom.com/wiki/${encodeURI(pg.title.replaceAll(' ', '_'))}?oldid=${rev.revid}`,
    wikitext: wt, images };
  const temporary = target + '.tmp';
  writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + '\n');
  renameSync(temporary, target);
  console.log(`${v.id}: revisione ${rev.revid}, ${images.filter(i => i.file).length}/${images.length} immagini salvate`);
}
if (wanted && !manifest.variants.some(v => v.id === wanted)) throw new Error(`Variante sconosciuta: ${wanted}`);
