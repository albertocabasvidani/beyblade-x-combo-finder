/**
 * fetch-wbo.ts — Accesso al thread WBO "Winning Combinations at WBO Organized Events - Beyblade X"
 * via Playwright headless (worldbeyblade.org è dietro Cloudflare).
 *
 * Primary source: gli organizzatori postano 1°/2°/3° posto con le combo esatte dopo ogni evento.
 * Questo script fa SOLO accesso+rendering: salva il testo grezzo delle ultime pagine del thread in
 * data/wbo-cache.json. L'estrazione/dedup delle combo la fa l'IA in /update-combos.
 *
 * Usa un userDataDir persistente dedicato: la clearance Cloudflare viene riusata tra i run.
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const cachePath = join(DATA, 'wbo-cache.json');
const USER_DIR = 'C:/Users/cinqu/.playwright-beyblade';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const THREADS = [
  { key: 'bbx-winning', url: 'https://worldbeyblade.org/Thread-Winning-Combinations-at-WBO-Organized-Events-Beyblade-X-BBX?action=lastpost' },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { threads: {} };
  cache.threads = cache.threads ?? {};

  // Cloudflare blocca il headless puro su worldbeyblade.org. Con WBO_HEADED=1 si forza la modalità
  // headed (richiede un desktop attivo): il profilo persistente conserva poi la clearance.
  // In headless bloccato, /update-combos usa MetaBeys, che indicizza gli stessi eventi WBO.
  const HEADLESS = process.env.WBO_HEADED !== '1';
  const ctx = await chromium.launchPersistentContext(USER_DIR, { channel: 'chrome', headless: HEADLESS, userAgent: UA });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    for (const t of THREADS) {
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        // attesa per superare l'eventuale challenge Cloudflare
        await page.waitForTimeout(6_000);
        const title = await page.title();
        if (/just a moment|attention required/i.test(title)) {
          await page.waitForTimeout(8_000); // secondo tentativo di clearance
        }
        // raccogli il testo dei post visibili (ultima pagina del thread)
        const raw = await page.locator('body').innerText().catch(() => '');
        const blocked = /just a moment|cloudflare|attention required/i.test(raw.slice(0, 400));
        cache.threads[t.key] = {
          url: t.url,
          fetchedAt: today(),
          blocked,
          raw: blocked ? '' : raw,
        };
        console.log(`WBO ${t.key}: ${blocked ? 'BLOCCATO da Cloudflare' : `${raw.length} char salvati`}.`);
      } catch (e) {
        console.warn(`WBO ${t.key} fallito: ${(e as Error).message}`);
        cache.threads[t.key] = { url: t.url, fetchedAt: today(), blocked: true, raw: '', error: (e as Error).message };
      }
    }
    cache.lastFetched = today();
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error('fetch-wbo fallito:', e.message); process.exit(1); });
