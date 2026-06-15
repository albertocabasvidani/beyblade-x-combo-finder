/**
 * fetch-metabeys.ts — Accesso a MetaBeys (JS app) via Playwright headless.
 *
 * MetaBeys è la fonte-dati torneo migliore: per ogni evento dà podio + deck complete
 * (Blade/Ratchet/Bit) dei top-cut. Questo script fa SOLO accesso+rendering: salva il testo
 * grezzo delle pagine evento in data/metabeys-cache.json. L'ESTRAZIONE delle combo la fa
 * l'IA in /update-combos (vincolo: il codice non interpreta).
 *
 * Dedup: salta gli eventi già in scan-history.scannedEvents (evita lavoro inutile).
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const cachePath = join(DATA, 'metabeys-cache.json');
const histPath = join(DATA, 'scan-history.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  const hist = existsSync(histPath) ? JSON.parse(readFileSync(histPath, 'utf8')) : {};
  hist.scannedEvents = hist.scannedEvents ?? {};
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { events: [] };

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  try {
    await page.goto('https://www.metabeys.com/events/completed?sort=Newest&page=1', { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForSelector('a[href^="/events/"]', { timeout: 30_000 }).catch(() => {});

    // Solo accesso/dedup: raccogli gli id evento numerici della prima pagina (i più recenti)
    const ids: string[] = await page.$$eval('a[href^="/events/"]', (as) =>
      Array.from(new Set(as.map((a) => (a.getAttribute('href') || '').split('/').pop()).filter(Boolean) as string[]))
    );
    const numericIds = ids.filter((id) => /^\d+$/.test(id));
    const fresh = numericIds.filter((id) => !hist.scannedEvents[id]);
    console.log(`MetaBeys: ${numericIds.length} eventi in pagina 1, ${fresh.length} nuovi da scaricare.`);

    const newEvents: any[] = [];
    for (const id of fresh) {
      try {
        await page.goto(`https://www.metabeys.com/events/${id}`, { waitUntil: 'networkidle', timeout: 60_000 });
        // attendi che la JS app renderizzi il contenuto evento
        await page.getByRole('button', { name: 'Top Cut' }).waitFor({ timeout: 20_000 }).catch(() => {});
        await page.getByRole('button', { name: 'Top Cut' }).click({ timeout: 5_000 }).catch(() => {});
        await page.getByText('Podium').first().waitFor({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(600);
        const raw = await page.innerText('body').catch(() => '');
        if (raw && raw.length > 200) {
          newEvents.push({ id, url: `https://www.metabeys.com/events/${id}`, fetchedAt: today(), raw });
          hist.scannedEvents[id] = { scannedDate: today(), combosFound: 0 };
        } else {
          console.warn(`MetaBeys evento ${id}: contenuto vuoto, non marcato (ritenta al prossimo run).`);
        }
      } catch (e) {
        console.warn(`MetaBeys evento ${id} fallito: ${(e as Error).message}`);
      }
    }

    // Leaderboard aggregata (snapshot grezzo, utile per usage %)
    let leaderboard = '';
    try {
      await page.goto('https://www.metabeys.com/leaderboard?kind=combo&tf=30d', { waitUntil: 'networkidle', timeout: 60_000 });
      await page.waitForSelector('table', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(600);
      leaderboard = await page.innerText('body').catch(() => '');
    } catch (e) {
      console.warn(`MetaBeys leaderboard fallita: ${(e as Error).message}`);
    }

    cache.events = [...newEvents, ...(cache.events ?? [])].slice(0, 200);
    cache.leaderboard = leaderboard || cache.leaderboard;
    cache.lastFetched = today();
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');
    console.log(`MetaBeys: salvati ${newEvents.length} nuovi eventi in metabeys-cache.json.`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('fetch-metabeys fallito:', e.message); process.exit(1); });
