/**
 * fetch-wbo.ts — Accesso al thread WBO "Winning Combinations at WBO Organized Events - Beyblade X"
 * via Playwright (worldbeyblade.org è dietro Cloudflare), con PAGINAZIONE STORICA all'indietro.
 *
 * Primary source: gli organizzatori postano 1°/2°/3° posto con le combo esatte dopo ogni evento.
 * Questo script fa SOLO accesso+rendering: salva il testo grezzo delle pagine del thread in
 * data/wbo-cache.json. L'estrazione/dedup delle combo la fa il parser deterministico (parse:wbo).
 *
 * Paginazione (capped + resumable, all'indietro):
 *  - Il thread MyBB è cronologico (pagina 1 = post più vecchi, ultima pagina = più recenti).
 *  - Ogni run rilegge l'ultima pagina (post nuovi) e poi scende dal cursore (`wboBackfill.nextPage`)
 *    per ≤ WBO_MAX_PAGES pagine, finché una pagina è interamente oltre il cutoff a 12 mesi.
 *  - Le pagine entro cutoff si accumulano in cache (`threads[key].pages`) e vengono concatenate in
 *    `threads[key].raw` (ordine cronologico) per il parser, che resta invariato.
 *
 * Cloudflare: il headless puro viene bloccato. Con WBO_HEADED=1 si forza la modalità headed (richiede
 * desktop attivo per risolvere il captcha); il profilo persistente conserva poi la clearance.
 * Canale: di default la vista forum (`?page=N`); con WBO_PRINTTHREAD=1 la versione stampabile
 * (`printthread.php?tid=...&page=N`, HTML più leggero) — da preferire se regge meglio.
 *
 * Env: WBO_HEADED, WBO_PRINTTHREAD, WBO_MAX_PAGES (default 3), COMBO_CUTOFF_MONTHS (default 12).
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { isFresh, CUTOFF_MONTHS } from './lib/freshness';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const cachePath = join(DATA, 'wbo-cache.json');
const histPath = join(DATA, 'scan-history.json');
// Profilo DEDICATO, non condiviso con scrape-reddit/scrape-arca (che usano
// .playwright-beyblade). Quando Reddit va in ETIMEDOUT lascia Chrome aggrappato al
// profilo, e qui launchPersistentContext falliva con "Target page, context or browser
// has been closed" — trascinandosi dietro il .bat chiamante. Stesso schema di
// fetch-bbx-weekly.ts (.playwright-bbx), l'unico fetcher che non ha mai fallito.
// Qui serve solo a conservare i cookie Cloudflare: nessun login da condividere.
const USER_DIR = 'C:/Users/cinqu/.playwright-wbo';

interface ThreadCfg { key: string; tid: number; base: string; }
// Thread attivi. Il canonico copre TUTTI gli eventi WBO BBX (1°/2°/3° posto). Candidati da valutare nel
// recon prima di promuoverli (formati eterogenei → rischio unresolved): "Results for the Beyblade X
// National Tournament 2025" (evento singolo). Da ESCLUDERE: "Winning Combinations at WBO Organized Play
// Events" (Burst/legacy, non X). La promozione è manuale: aggiungere qui solo i thread validati.
const THREADS: ThreadCfg[] = [
  { key: 'bbx-winning', tid: 110113, base: 'https://worldbeyblade.org/Thread-Winning-Combinations-at-WBO-Organized-Events-Beyblade-X-BBX' },
];

const PRINTTHREAD = process.env.WBO_PRINTTHREAD === '1';
const MAX_PAGES = Math.max(1, parseInt(process.env.WBO_MAX_PAGES ?? '3', 10) || 3);
const HEADLESS = process.env.WBO_HEADED !== '1';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const pageUrl = (t: ThreadCfg, n: number) =>
  PRINTTHREAD ? `https://worldbeyblade.org/printthread.php?tid=${t.tid}&page=${n}` : `${t.base}?page=${n}`;

/** Estrae il numero di pagina massimo dal markup di paginazione MyBB. 1 se non trovato. */
function maxPageFrom(html: string): number {
  let max = 1;
  for (const m of html.matchAll(/[?&]page=(\d+)/g)) max = Math.max(max, parseInt(m[1], 10));
  const pm = html.match(/Pages\s*\((\d+)\)/i);
  if (pm) max = Math.max(max, parseInt(pm[1], 10));
  return max;
}

const toIso = (mm: string, dd: string, yyyy: string) => `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
/** Data ISO più recente trovata nel raw: campi evento "Date: MM/DD/YYYY" e timestamp MyBB MM-DD-YYYY. */
function newestIso(raw: string): string | null {
  let best: string | null = null;
  const consider = (iso: string) => { if (!best || iso > best) best = iso; };
  for (const m of raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) consider(toIso(m[1], m[2], m[3]));
  for (const m of raw.matchAll(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/g)) consider(toIso(m[1], m[2], m[3]));
  return best;
}

async function main() {
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { threads: {} };
  cache.threads = cache.threads ?? {};
  const hist = existsSync(histPath) ? JSON.parse(readFileSync(histPath, 'utf8')) : {};
  hist.wboBackfill = hist.wboBackfill ?? {};

  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    channel: 'chrome',
    headless: HEADLESS,
    chromiumSandbox: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const CHALLENGE = /just a moment|attention required|cloudflare|verify you are human|checking your browser/i;
  const maxWaitMs = HEADLESS ? 12_000 : 180_000;

  // WBO è HTML server-side (MyBB), non una SPA: serve Chrome solo per passare Cloudflare (la clearance
  // è legata al fingerprint del browser, non riusabile via fetch). Quindi NIENTE attesa fissa: si
  // controlla subito se la pagina è sfidata e si aspetta SOLO in quel caso. Pagine già "clear" tornano
  // in ~istante (una sola lettura), non più 3s a pagina.
  const challenged = async () => {
    const title = (await page.title().catch(() => '')) || '';
    const head = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
    return CHALLENGE.test(title + ' ' + head);
  };
  /** Naviga e attende l'eventuale clearance Cloudflare. Ritorna { ok, raw } (ok=false se bloccato). */
  async function load(url: string): Promise<{ ok: boolean; raw: string; html: string }> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    let cleared = !(await challenged());
    if (!cleared) {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        await page.waitForTimeout(3_000);
        if (!(await challenged())) { cleared = true; break; }
      }
    }
    const raw = await page.locator('body').innerText().catch(() => '');
    const html = await page.content().catch(() => '');
    const ok = cleared && !CHALLENGE.test(raw.slice(0, 400));
    return { ok, raw, html };
  }

  try {
    for (const t of THREADS) {
      const slot = cache.threads[t.key] ?? { pages: {} };
      slot.pages = slot.pages ?? {};
      const cur = hist.wboBackfill[t.key] ?? { nextPage: null, done: false, lastPage: 0 };

      // Landing sull'ultima pagina (clear Cloudflare + scopri il numero di pagine).
      if (!HEADLESS) console.log(`WBO ${t.key}: risolvi l'eventuale captcha Cloudflare nella finestra (attendo fino a 3 min)...`);
      const landing = await load(`${t.base}?action=lastpost`);
      if (!landing.ok) {
        // Bloccato: NON azzerare la cache buona esistente. Se c'è raw preservato dal run headed
        // precedente la cache resta usabile (blocked:false, fetchedAt invariato); solo senza alcun raw
        // si segna blocked:true. Così parse:wbo continua a leggere i dati buoni anche dopo un run headless.
        cache.threads[t.key] = { ...slot, url: t.base, fetchedAt: slot.fetchedAt ?? today(), blocked: !slot.raw, raw: slot.raw ?? '', pages: slot.pages ?? {} };
        console.warn(`WBO ${t.key}: BLOCCATO da Cloudflare (in headless è il caso normale; usa WBO_HEADED=1).`);
        continue;
      }
      const lastPage = maxPageFrom(landing.html);
      console.log(`WBO ${t.key}: ultima pagina = ${lastPage}.`);

      // (a) Pagina più recente: cattura i post nuovi.
      slot.pages[lastPage] = (await load(pageUrl(t, lastPage))).raw;

      // (b) Backfill all'indietro dal cursore, capped a WBO_MAX_PAGES.
      if (cur.nextPage == null || cur.nextPage >= lastPage) cur.nextPage = lastPage - 1;
      let walked = 0;
      while (!cur.done && cur.nextPage >= 1 && walked < MAX_PAGES) {
        const { raw } = await load(pageUrl(t, cur.nextPage));
        const iso = newestIso(raw);
        if (iso && !isFresh(iso)) { console.log(`WBO ${t.key}: pagina ${cur.nextPage} oltre cutoff (${iso}) → stop.`); cur.done = true; break; }
        slot.pages[cur.nextPage] = raw;
        cur.nextPage--;
        walked++;
      }
      cur.lastPage = lastPage;
      hist.wboBackfill[t.key] = cur;

      // Pota le pagine interamente oltre cutoff e concatena le restanti in ordine cronologico.
      for (const k of Object.keys(slot.pages)) {
        const iso = newestIso(slot.pages[k]);
        if (iso && !isFresh(iso)) delete slot.pages[k];
      }
      const ordered = Object.keys(slot.pages).map(Number).sort((a, b) => a - b);
      const raw = ordered.map((n) => slot.pages[n]).join('\n\n');
      cache.threads[t.key] = { url: t.base, fetchedAt: today(), blocked: false, lastPage, pages: slot.pages, raw };
      console.log(
        `WBO ${t.key}: ${ordered.length} pagine in cache (${raw.length} char). ` +
        `Backfill: ${cur.done ? `completo (cutoff ${CUTOFF_MONTHS} mesi)` : `in corso, prossima pagina ${cur.nextPage}`}.`,
      );
    }
    cache.lastFetched = today();
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error('fetch-wbo fallito:', e.message); process.exit(1); });
