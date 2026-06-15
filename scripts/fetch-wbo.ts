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
  // Niente UA fittizio né flag di automazione: Cloudflare Turnstile flagga il mismatch UA, il
  // --no-sandbox (default di launchPersistentContext) e --enable-automation/navigator.webdriver, e
  // ripresenta il captcha all'infinito. Con il Chrome reale (channel) e senza queste impronte la
  // risoluzione manuale "tiene".
  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    channel: 'chrome',
    headless: HEADLESS,
    chromiumSandbox: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    const CHALLENGE = /just a moment|attention required|cloudflare|verify you are human|checking your browser/i;
    // Headless: attesa breve (probabile blocco). Headed: attesa lunga per la risoluzione MANUALE del captcha.
    const maxWaitMs = HEADLESS ? 12_000 : 180_000;
    for (const t of THREADS) {
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        if (!HEADLESS) console.log(`WBO ${t.key}: risolvi l'eventuale captcha Cloudflare nella finestra del browser (attendo fino a 3 min, NON chiudo)...`);
        const start = Date.now();
        let cleared = false;
        while (Date.now() - start < maxWaitMs) {
          await page.waitForTimeout(3_000);
          const title = (await page.title().catch(() => '')) || '';
          const head = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
          if (!CHALLENGE.test(title + ' ' + head)) { cleared = true; break; }
        }
        const raw = await page.locator('body').innerText().catch(() => '');
        const blocked = !cleared || CHALLENGE.test(raw.slice(0, 400));
        cache.threads[t.key] = { url: t.url, fetchedAt: today(), blocked, raw: blocked ? '' : raw };
        console.log(`WBO ${t.key}: ${blocked ? 'BLOCCATO da Cloudflare (timeout o challenge non risolto)' : `${raw.length} char salvati`}.`);
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
