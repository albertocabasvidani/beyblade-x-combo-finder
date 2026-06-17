/**
 * fetch-metabeys.ts — Accesso a MetaBeys (JS app) via Playwright headless, con PAGINAZIONE STORICA.
 *
 * MetaBeys è la fonte-dati torneo migliore: per ogni evento dà podio + deck complete
 * (Blade/Ratchet/Bit) dei top-cut. Questo script fa SOLO accesso+rendering: salva il testo
 * grezzo delle pagine evento in data/metabeys-cache.json. L'ESTRAZIONE delle combo la fa
 * l'IA in /update-combos (vincolo: il codice non interpreta).
 *
 * Paginazione (capped + resumable):
 *  - Ogni run rilegge la pagina 1 (`?sort=Newest&page=1`) per catturare gli eventi nuovi.
 *  - Un cursore in scan-history (`metabeysBackfill.nextPage`) avanza il backfill nelle pagine non
 *    ancora viste, al massimo META_MAX_PAGES per run, finché non si supera il cutoff a 12 mesi
 *    (src/lib/freshness) o finisce l'archivio. Così il backfill storico si completa in più run.
 *  - Dedup su scan-history.scannedEvents: evita il RE-FETCH del contenuto, NON la scoperta storica
 *    (la scoperta la fa il loop sulle pagine). La data evento viene salvata in `eventDate` così i
 *    run futuri sanno fermarsi senza riscaricare.
 *
 * Env: META_MAX_PAGES (default 3 — alzalo per un backfill one-shot), COMBO_CUTOFF_MONTHS (default 12).
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { isFresh, parseLongDate, CUTOFF_MONTHS } from './lib/freshness';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const cachePath = join(DATA, 'metabeys-cache.json');
const histPath = join(DATA, 'scan-history.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const LIST_URL = (page: number) => `https://www.metabeys.com/events/completed?sort=Newest&page=${page}`;
const MAX_PAGES = Math.max(1, parseInt(process.env.META_MAX_PAGES ?? '3', 10) || 3);
const CACHE_BACKSTOP = 400; // tetto numerico di sicurezza oltre il prune per data

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

async function main() {
  const hist = existsSync(histPath) ? JSON.parse(readFileSync(histPath, 'utf8')) : {};
  hist.scannedEvents = hist.scannedEvents ?? {};
  hist.metabeysBackfill = hist.metabeysBackfill ?? { nextPage: 2, done: false };
  const bf = hist.metabeysBackfill;
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { events: [] };

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  const newEvents: any[] = [];
  let page1Ids: string[] = [];

  /** Legge gli id evento numerici (ordine pagina, Newest) della pagina lista N. [] se nessuno. */
  async function listIds(pageNum: number): Promise<string[]> {
    await page.goto(LIST_URL(pageNum), { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForSelector('a[href^="/events/"]', { timeout: 30_000 }).catch(() => {});
    const ids: string[] = await page.$$eval('a[href^="/events/"]', (as) =>
      Array.from(new Set(as.map((a) => (a.getAttribute('href') || '').split('/').pop()).filter(Boolean) as string[]))
    );
    return ids.filter((id) => /^\d+$/.test(id));
  }

  /** Scarica la pagina evento e ritorna il raw renderizzato (o '' se vuoto). */
  async function fetchEventRaw(id: string): Promise<string> {
    await page.goto(`https://www.metabeys.com/events/${id}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByRole('button', { name: 'Top Cut' }).waitFor({ timeout: 20_000 }).catch(() => {});
    await page.getByRole('button', { name: 'Top Cut' }).click({ timeout: 5_000 }).catch(() => {});
    await page.getByText('Podium').first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600);
    return (await page.innerText('body').catch(() => '')) || '';
  }

  /**
   * Processa una pagina lista: scarica gli eventi freschi non ancora visti, marca scan-history,
   * e si ferma al primo evento oltre cutoff (ordine Newest ⇒ i successivi sono più vecchi).
   * Ritorna se la pagina aveva eventi e se ha raggiunto il cutoff (o una pagina "fasulla" = ripetizione).
   */
  async function processList(pageNum: number): Promise<{ hadEvents: boolean; reachedCutoff: boolean }> {
    const ids = await listIds(pageNum);
    console.log(`MetaBeys pagina ${pageNum}: ${ids.length} eventi in lista.`);
    if (ids.length === 0) return { hadEvents: false, reachedCutoff: false };
    if (pageNum === 1) page1Ids = ids;
    else if (page1Ids.length && sameSet(ids, page1Ids)) {
      console.warn(`MetaBeys: la pagina ${pageNum} ripete la pagina 1 → paginazione ?page=N non attiva. Stop backfill.`);
      return { hadEvents: false, reachedCutoff: true };
    }

    let reachedCutoff = false;
    for (const id of ids) {
      const known = hist.scannedEvents[id];
      if (known) {
        if (known.eventDate && !isFresh(known.eventDate)) { reachedCutoff = true; break; }
        continue; // già scaricato: niente re-fetch
      }
      const raw = await fetchEventRaw(id);
      if (!raw || raw.length <= 200) {
        console.warn(`MetaBeys evento ${id}: contenuto vuoto, non marcato (ritenta al prossimo run).`);
        continue;
      }
      const date = parseLongDate(raw) ?? undefined;
      if (date && !isFresh(date)) {
        // Oltre cutoff: ricorda la data (così non lo si riscarica) e ferma la discesa.
        hist.scannedEvents[id] = { scannedDate: today(), eventDate: date, combosFound: 0, beyondCutoff: true };
        reachedCutoff = true;
        break;
      }
      newEvents.push({ id, url: `https://www.metabeys.com/events/${id}`, fetchedAt: today(), raw });
      hist.scannedEvents[id] = { scannedDate: today(), eventDate: date, combosFound: 0 };
    }
    return { hadEvents: true, reachedCutoff };
  }

  try {
    // (a) Pagina 1: cattura sempre i nuovi eventi.
    const p1 = await processList(1);
    if (p1.reachedCutoff) bf.done = true;

    // (b) Backfill incrementale dalle pagine non ancora viste, capped a META_MAX_PAGES per run.
    let walked = 0;
    while (!bf.done && walked < MAX_PAGES) {
      const r = await processList(bf.nextPage);
      if (!r.hadEvents) { bf.done = true; break; } // fine archivio o pagina fasulla
      if (r.reachedCutoff) { bf.done = true; break; }
      bf.nextPage++;
      walked++;
    }
    console.log(
      `MetaBeys: ${newEvents.length} nuovi eventi scaricati. ` +
      `Backfill: ${bf.done ? `completo (cutoff ${CUTOFF_MONTHS} mesi)` : `in corso, prossima pagina ${bf.nextPage}`}.`,
    );

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

    // Cache: dedup per id (i nuovi vincono), poi prune per data evento (entro cutoff) + backstop numerico.
    const merged = [...newEvents, ...(cache.events ?? [])];
    const byId = new Map<string, any>();
    for (const e of merged) if (!byId.has(e.id)) byId.set(e.id, e);
    const kept = [...byId.values()].filter((e) => isFresh(parseLongDate(e.raw ?? '') ?? ''));
    cache.events = kept.slice(0, CACHE_BACKSTOP);
    cache.leaderboard = leaderboard || cache.leaderboard;
    cache.lastFetched = today();
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');
    console.log(`MetaBeys: cache con ${cache.events.length} eventi (entro ${CUTOFF_MONTHS} mesi).`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('fetch-metabeys fallito:', e.message); process.exit(1); });
