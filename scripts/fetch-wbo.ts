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
 *  - Ogni run atterra sull'ultima pagina e poi RECUPERA all'indietro fino alla frontiera già in cache
 *    (la pagina massima salvata, riscaricata perché era parziale quando fu letta), al massimo
 *    WBO_CATCHUP_MAX pagine: così dopo un periodo di run falliti le pagine mancanti rientrano da sole.
 *  - Sotto la frontiera prosegue il backfill storico dal cursore (`wboBackfill.nextPage`), per
 *    ≤ WBO_MAX_PAGES pagine, finché una pagina è interamente oltre il cutoff a 12 mesi.
 *  - Le pagine entro cutoff si accumulano in cache (`threads[key].pages`) e vengono concatenate in
 *    `threads[key].raw` (ordine cronologico) per il parser, che resta invariato.
 *
 * Cloudflare: il headless puro viene bloccato. Con WBO_HEADED=1 si forza la modalità headed (richiede
 * desktop attivo per risolvere il captcha); il profilo persistente conserva poi la clearance.
 * Misurato sul server dal 06/08 al 26/09/2026: la challenge non ha mai bloccato il run (mai un
 * «BLOCCATO»), ma in 38 run su 52 il documento veniva letto PRIMA che il thread fosse renderizzato,
 * e «ultima pagina = 1» azzerava il cursore in silenzio. Per questo `load()` aspetta il marcatore di
 * pagina-thread e il numero di pagina viene creduto solo se non arretra rispetto alla cache
 * (scripts/lib/wbo-fetch-utils.ts). Un run che non legge il thread esce con codice 2 e non tocca né
 * cache né cursore.
 * Canale: di default la vista forum (`?page=N`); con WBO_PRINTTHREAD=1 la versione stampabile
 * (`printthread.php?tid=...&page=N`, HTML più leggero) — da preferire se regge meglio.
 *
 * Env: WBO_HEADED, WBO_PRINTTHREAD, WBO_MAX_PAGES (default 3), WBO_CATCHUP_MAX (default 20),
 * COMBO_CUTOFF_DAYS (default 365).
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { isFresh, CUTOFF_DAYS } from './lib/freshness';
import { maxPageFrom, newestIso, looksLikeThread, isPlausibleLastPage, cacheFrontier, cacheFloor, pageFromUrl } from './lib/wbo-fetch-utils';

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
const USER_DIR = `${(process.env.USERPROFILE || '').replace(/\\/g, '/')}/.playwright-wbo`;

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
const CATCHUP_MAX = Math.max(1, parseInt(process.env.WBO_CATCHUP_MAX ?? '20', 10) || 20);
const HEADLESS = process.env.WBO_HEADED !== '1';
// Attesa del thread vero dopo la challenge: il redirect di Cloudflare è via JavaScript, quindi `goto`
// non lo aspetta e per qualche istante il documento è vuoto o intermedio.
const THREAD_WAIT_MS = 20_000;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const pageUrl = (t: ThreadCfg, n: number) =>
  PRINTTHREAD ? `https://worldbeyblade.org/printthread.php?tid=${t.tid}&page=${n}` : `${t.base}?page=${n}`;

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
  const CHALLENGE = /just a moment|attention required|cloudflare|verify you are human|checking your browser|ci siamo quasi|verifica di sicurezza/i;
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
  const bodyText = () => page.locator('body').innerText().catch(() => '');
  /**
   * Naviga, attende l'eventuale clearance Cloudflare e POI il thread renderizzato. Ritorna
   * { ok, raw, html, url }: ok=false se bloccato o se entro THREAD_WAIT_MS il documento non è mai
   * diventato una pagina-thread (documento vuoto/intermedio: prima passava per buono).
   */
  async function load(url: string): Promise<{ ok: boolean; raw: string; html: string; url: string }> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    let cleared = !(await challenged());
    if (!cleared) {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        await page.waitForTimeout(3_000);
        if (!(await challenged())) { cleared = true; break; }
      }
    }
    let raw = await bodyText();
    if (cleared) {
      const start = Date.now();
      while (!looksLikeThread(raw) && Date.now() - start < THREAD_WAIT_MS) {
        await page.waitForTimeout(1_000);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        raw = await bodyText();
      }
    }
    const html = await page.content().catch(() => '');
    const ok = cleared && !CHALLENGE.test(raw.slice(0, 400)) && looksLikeThread(raw);
    return { ok, raw, html, url: page.url() };
  }

  let invalid = 0;
  try {
    for (const t of THREADS) {
      const slot = cache.threads[t.key] ?? { pages: {} };
      slot.pages = slot.pages ?? {};
      const cur = hist.wboBackfill[t.key] ?? { nextPage: null, done: false, lastPage: 0 };
      const frontier = cacheFrontier(slot.pages);
      // Run invalido: cache e cursore restano quelli di prima (con `blocked` solo se non c'è alcun raw,
      // così parse:wbo continua a leggere i dati buoni), e il processo esce con codice 2.
      const keepAsIs = (why: string) => {
        cache.threads[t.key] = { ...slot, url: t.base, fetchedAt: slot.fetchedAt ?? today(), blocked: !slot.raw, raw: slot.raw ?? '', pages: slot.pages };
        console.warn(`WBO ${t.key}: ${why} → cache (frontiera ${frontier}) e cursore intatti.`);
        invalid++;
      };

      // Landing sull'ultima pagina (clear Cloudflare + scopri il numero di pagine).
      if (!HEADLESS) console.log(`WBO ${t.key}: risolvi l'eventuale captcha Cloudflare nella finestra (attendo fino a 3 min)...`);
      const landing = await load(`${t.base}?action=lastpost`);
      if (!landing.ok) { keepAsIs('BLOCCATO da Cloudflare o thread non renderizzato (in headless è il caso normale; usa WBO_HEADED=1)'); continue; }
      const lastPage = maxPageFrom(landing.html);
      if (!isPlausibleLastPage(lastPage, frontier)) { keepAsIs(`ultima pagina letta = ${lastPage}, ma in cache c'è già la ${frontier}: pagina non attendibile`); continue; }
      console.log(`WBO ${t.key}: ultima pagina = ${lastPage}.`);

      // (a) Pagina più recente. L'atterraggio `?action=lastpost` È già l'ultima pagina: se l'URL finale
      // lo conferma si riusa quel testo, una richiesta (ed esposizione a Cloudflare) in meno.
      let ok = true;
      if (pageFromUrl(landing.url) === lastPage) {
        slot.pages[lastPage] = landing.raw;
      } else {
        const newest = await load(pageUrl(t, lastPage));
        if (newest.ok) slot.pages[lastPage] = newest.raw;
        else { console.warn(`WBO ${t.key}: pagina ${lastPage} non letta.`); ok = false; }
      }

      // (b) Recupero: dalla pagina sotto l'ultima giù fino alla frontiera inclusa (era parziale quando
      // fu salvata). Dopo giorni di run falliti è qui che le pagine mancanti rientrano, da sole.
      let caught = 0;
      for (let n = lastPage - 1; ok && n >= Math.max(frontier, 1) && caught < CATCHUP_MAX; n--) {
        const got = await load(pageUrl(t, n));
        if (!got.ok) { console.warn(`WBO ${t.key}: pagina ${n} non letta, recupero interrotto (riprende al prossimo run).`); ok = false; break; }
        slot.pages[n] = got.raw;
        caught++;
      }
      if (caught) console.log(`WBO ${t.key}: recuperate ${caught} pagine (${lastPage - 1} → ${lastPage - caught}).`);

      // (c) Backfill storico sotto la pagina più bassa in cache, dal cursore, capped a WBO_MAX_PAGES.
      const floor = cacheFloor(slot.pages);
      if (cur.nextPage == null || cur.nextPage >= floor) cur.nextPage = floor - 1;
      let walked = 0;
      while (ok && !cur.done && cur.nextPage >= 1 && walked < MAX_PAGES) {
        const got = await load(pageUrl(t, cur.nextPage));
        if (!got.ok) { console.warn(`WBO ${t.key}: pagina ${cur.nextPage} non letta, backfill interrotto.`); ok = false; break; }
        const iso = newestIso(got.raw);
        if (iso && !isFresh(iso)) { console.log(`WBO ${t.key}: pagina ${cur.nextPage} oltre cutoff (${iso}) → stop.`); cur.done = true; break; }
        slot.pages[cur.nextPage] = got.raw;
        cur.nextPage--;
        walked++;
      }
      cur.lastPage = lastPage;
      hist.wboBackfill[t.key] = cur;
      if (!ok) invalid++;

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
        `Backfill: ${cur.done ? `completo (cutoff ${CUTOFF_DAYS} giorni)` : `in corso, prossima pagina ${cur.nextPage}`}.`,
      );
    }
    cache.lastFetched = today();
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');
  } finally {
    await ctx.close();
  }
  // Codice 2: collect-sources lo conta come fallimento e lo scrive nel log, senza fermare le altre fonti.
  if (invalid) process.exitCode = 2;
}

main().catch((e) => { console.error('fetch-wbo fallito:', e.message); process.exit(1); });
