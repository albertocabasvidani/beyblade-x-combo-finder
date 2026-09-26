/**
 * ig-generate.ts — Genera i caroselli Instagram candidati (immagini JPEG 1080×1350 + didascalia) da
 * combos.json, in out/ig/ (gitignorato). Deterministico: gira nel giro notturno dopo score:combos.
 *
 * Non pubblica niente: chi sceglie il post del giorno e lo manda su Instagram è tools/caroselli.py del
 * progetto contenuti (stessa macchina, il homeserver), che legge out/ig/queue.json. Gli id dei post sono
 * stabili (top-build-2026-W40, build-lama-shark-scale…): rigenerare ogni notte aggiorna i numeri, non
 * l'identità, e il registro del pubblicatore decide cosa è già uscito.
 *
 * Immagini in JPEG perché l'API di pubblicazione di Instagram accetta solo JPEG. Chrome di sistema via
 * playwright-core (come gli altri fetcher); i font arrivano da Google Fonts, con attesa di
 * document.fonts.ready e un tetto di 10 s (senza rete escono i font di ripiego, non un errore).
 *
 * Uso: npx tsx scripts/ig-generate.ts [--only <id>] [--dry]   (--dry: solo queue.json, niente immagini)
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { computeCandidates, isoDate, type Combo, type Registry } from './lib/ig-posts';
import { renderCaption, renderSlides, type RenderCtx } from './lib/ig-render';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'out', 'ig');
const IMAGES = join(ROOT, 'public', 'images', 'parts');
const KEEP_DAYS = 21;
const JPEG_QUALITY = 88;

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const dry = args.includes('--dry');

async function main() {
  const db = JSON.parse(readFileSync(join(ROOT, 'data', 'combos.json'), 'utf8')) as { lastUpdated?: string; combos: Combo[] };
  const parts = JSON.parse(readFileSync(join(ROOT, 'data', 'parts.json'), 'utf8')) as Registry;
  const byId: Record<string, { name: string; image?: string }> = {};
  for (const k of ['blades', 'ratchets', 'bits'] as const) for (const p of parts[k] ?? []) byId[p.id] = p;
  const dataUri: Record<string, string> = {};
  const ctx: RenderCtx = {
    name: (id) => byId[id]?.name ?? id,
    img: (id) => {
      if (id in dataUri) return dataUri[id];
      const file = byId[id]?.image ? join(IMAGES, byId[id].image!) : '';
      dataUri[id] = file && existsSync(file) ? `data:image/png;base64,${readFileSync(file).toString('base64')}` : '';
      return dataUri[id];
    },
    asOf: (db.lastUpdated ?? new Date().toISOString()).slice(0, 10).split('-').reverse().join('/'),
  };

  const ref = new Date(db.lastUpdated ?? Date.now());
  let candidates = computeCandidates(db.combos, ref);
  if (only) candidates = candidates.filter((c) => c.id === only);
  mkdirSync(OUT, { recursive: true });

  const browser = dry ? null : await chromium.launch({ channel: 'chrome', headless: true });
  const page = browser ? await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 }) : null;
  const queue: any[] = [];
  try {
    for (const c of candidates) {
      const dir = join(OUT, c.id);
      mkdirSync(dir, { recursive: true });
      const slides = renderSlides(ctx, c);
      if (page) {
        for (let i = 0; i < slides.length; i++) {
          await page.setContent(slides[i], { waitUntil: 'load' });
          await page.evaluate(() => Promise.race([(document as any).fonts.ready, new Promise((r) => setTimeout(r, 10_000))]));
          await page.screenshot({ path: join(dir, `${i + 1}.jpg`), type: 'jpeg', quality: JPEG_QUALITY });
        }
      }
      const caption = renderCaption(ctx, c);
      writeFileSync(join(dir, 'caption.txt'), caption, 'utf8');
      const post = { id: c.id, type: c.type, week: c.week ?? null, blade: c.blade ?? null, priority: c.priority, slides: slides.length, generatedAt: isoDate(new Date()), dataAsOf: ctx.asOf, dir };
      writeFileSync(join(dir, 'post.json'), JSON.stringify({ ...post, data: c.data }, null, 2) + '\n', 'utf8');
      queue.push(post);
      console.log(`ig: ${c.id} (${slides.length} slide${page ? '' : ', solo testo'})`);
    }
  } finally {
    await browser?.close();
  }
  if (!only) {
    writeFileSync(join(OUT, 'queue.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dataAsOf: ctx.asOf, posts: queue }, null, 2) + '\n', 'utf8');
    // Cartelle non più in coda e più vecchie di KEEP_DAYS: via (i settimanali passati, gli eventi chiusi).
    const keep = new Set(queue.map((p) => p.id));
    const limit = Date.now() - KEEP_DAYS * 86400000;
    for (const d of readdirSync(OUT)) {
      const p = join(OUT, d);
      if (!keep.has(d) && statSync(p).isDirectory() && statSync(p).mtimeMs < limit) rmSync(p, { recursive: true, force: true });
    }
  }
  console.log(`ig: ${queue.length} post in coda → ${OUT}`);
}

main().catch((e) => { console.error('ig-generate fallito:', e.message); process.exit(1); });
