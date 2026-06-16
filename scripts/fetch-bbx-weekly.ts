/**
 * fetch-bbx-weekly.ts — Cattura il raw di BBX Weekly (bbxweekly.com), ranking PER-PARTE aggiornato
 * ogni venerdì. Fonte di CROSS-CHECK indipendente da MetaBeys/WBO: NON alimenta lo score CAS.
 *
 * BBX Weekly classifica le PARTI (Lock Chip/Ratchet/Blade), non le combo né gli eventi: per questo
 * non c'è rischio di doppio conteggio con i placement per-evento (che restano la base del CAS).
 * Qui si cattura solo il testo grezzo delle pagine; l'interpretazione la fa parse-bbx-weekly.ts
 * (ancorata al registro parti) e, dove utile, l'IA in /update-combos.
 *
 * Pubblico: di norma headless basta. BBX_HEADED=1 per fallback con finestra visibile.
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_PATH = join(ROOT, 'data', 'bbx-weekly-cache.json');
const COMBOS_PATH = join(ROOT, 'data', 'combos.json');
const HEADED = process.env.BBX_HEADED === '1';
const PAGES = [
  { url: 'https://bbxweekly.com/4weeks', window: '4w' },
  { url: 'https://bbxweekly.com/2weeks', window: '2w' },
];
const BLOCK = /just a moment|attention required|cloudflare|access denied/i;

interface BbxPage { url: string; window: string; text: string; fetchedAt: string }
interface BbxCache { lastScraped: string; pages: BbxPage[] }

const today = () => new Date().toISOString().slice(0, 10);
function loadCache(): BbxCache {
  if (!existsSync(CACHE_PATH)) return { lastScraped: '', pages: [] };
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); } catch { return { lastScraped: '', pages: [] }; }
}

async function main() {
  console.log(`BBX Weekly fetch (browser ${HEADED ? 'headed' : 'headless'})\n`);
  const existing = loadCache();

  const ctx = await chromium.launchPersistentContext('C:/Users/cinqu/.playwright-bbx', {
    channel: 'chrome', headless: !HEADED, chromiumSandbox: true,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const out: BbxPage[] = [];

  try {
    for (const p of PAGES) {
      try {
        await page.goto(p.url, { waitUntil: 'networkidle', timeout: 45000 });
      } catch {
        console.error(`  ${p.url}: non raggiungibile, salto.`);
        continue;
      }
      const text = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
      if (BLOCK.test(text.slice(0, 400)) || text.length < 50) {
        console.error(`  ${p.url}: bloccato o vuoto, salto.`);
        continue;
      }
      out.push({ url: p.url, window: p.window, text: text.slice(0, 20000), fetchedAt: today() });
      console.log(`  ${p.url}: ${text.length} char catturati.`);
    }

    if (out.length === 0) {
      console.error(`Nessuna pagina utile. Cache preservata (${existing.pages.length} pagine).`);
      return;
    }

    writeFileSync(CACHE_PATH, JSON.stringify({ lastScraped: today(), pages: out }, null, 2));
    console.log(`\nSalvate ${out.length} pagine in ${CACHE_PATH}`);

    // Cross-check di freschezza: BBX aggiorna ogni venerdì; se i nostri dati sono più vecchi, avvisa.
    if (existsSync(COMBOS_PATH)) {
      try {
        const db = JSON.parse(readFileSync(COMBOS_PATH, 'utf-8'));
        const ourDate = (db.lastUpdated ?? '').slice(0, 10);
        if (ourDate && ourDate < today()) {
          const days = Math.round((Date.parse(today()) - Date.parse(ourDate)) / 86_400_000);
          if (days >= 7) console.warn(`⚠ Cross-check: BBX Weekly è di oggi ma combos.json è fermo da ${days} giorni (${ourDate}). Possibile staleness della pipeline.`);
        }
      } catch { /* ignore */ }
    }
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error('fetch-bbx-weekly fallito:', e.message); });
