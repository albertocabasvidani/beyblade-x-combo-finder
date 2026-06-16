/**
 * scrape-arca.ts — Raccoglie i post del canale Beyblade di arca.live (forum coreano pubblico).
 *
 * Riempie il buco di copertura della scena KR (vedi audit 16/06/2026). Stesso pattern di
 * scrape-reddit / fetch-wbo: Playwright col Chrome di sistema e profilo persistente, headless di
 * default con fallback headed (ARCA_HEADED=1) se Cloudflare blocca. NON distruttivo: su
 * blocco/errore/0 risultati preserva la cache; i post nuovi si uniscono per id.
 *
 * Confine IA/codice: qui si raccoglie SOLO il testo grezzo (titolo + corpo + commenti). L'estrazione
 * delle combo dai post in coreano (match nomi parti multilingua) la fa l'IA in /update-combos, come
 * per le altre fonti narrative — il codice non interpreta il coreano.
 *
 * Modalità:
 *  - ARCA_HEADED=1 npm run scrape:arca  → headed (per risolvere a mano un eventuale captcha Cloudflare).
 *  - npm run scrape:arca (headless, da collect:sources/scheduler) → se bloccato, no-op che preserva la cache.
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_PATH = join(ROOT, 'data', 'arca-cache.json');
const USER_DIR = 'C:/Users/cinqu/.playwright-arca';
const HEADED = process.env.ARCA_HEADED === '1';
const BOARD = 'https://arca.live/b/beyblade';
const KEEP_TOP = 120;        // post tenuti in cache (i più recenti)
const MAX_ARTICLES = 30;     // articoli letti per run (i più recenti della lista)
const BLOCK = /just a moment|attention required|cloudflare|access denied/i;

interface ArcaPost { id: string; title: string; body: string; url: string; date: string; }
interface ArcaCache { lastScraped: string; posts: ArcaPost[]; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

function loadCache(): ArcaCache {
  if (!existsSync(CACHE_PATH)) return { lastScraped: '', posts: [] };
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); } catch { return { lastScraped: '', posts: [] }; }
}

const articleId = (href: string): string | null => href.match(/\/b\/beyblade\/(\d+)/)?.[1] ?? null;

async function isBlocked(page: any): Promise<boolean> {
  const t = (await page.locator('body').innerText().catch(() => '')) || '';
  return BLOCK.test(t.slice(0, 400));
}

async function main() {
  console.log(`arca.live scraper /b/beyblade (browser ${HEADED ? 'headed' : 'headless'})\n`);
  const existing = loadCache();

  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    channel: 'chrome', headless: !HEADED, chromiumSandbox: true,
    ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    try {
      await page.goto(BOARD, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch {
      console.error(`Board non raggiungibile. Cache preservata (${existing.posts.length} post).`);
      return;
    }
    if (await isBlocked(page)) {
      if (HEADED) {
        console.log('Cloudflare challenge: risolvilo nella finestra (attendo fino a 2 min)...');
        const start = Date.now();
        while (Date.now() - start < 120_000) {
          await sleep(6000);
          if (!(await isBlocked(page))) break;
        }
      }
      if (await isBlocked(page)) {
        console.error('Bloccato da Cloudflare (headless). Usa ARCA_HEADED=1. Cache preservata.');
        return;
      }
    }

    // Raccoglie i link agli articoli dalla lista del canale.
    const links: { href: string; text: string }[] = await page
      .$$eval('a[href*="/b/beyblade/"]', (as: any[]) =>
        as.map((a) => ({ href: a.href as string, text: (a.innerText || '').trim() })),
      )
      .catch(() => []);

    const seen = new Set<string>();
    const queue: { id: string; url: string; title: string }[] = [];
    for (const l of links) {
      const id = articleId(l.href);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (l.text && l.text.length > 1) queue.push({ id, url: `${BOARD}/${id}`, title: l.text });
      if (queue.length >= MAX_ARTICLES) break;
    }

    if (queue.length === 0) {
      console.error(`Nessun articolo trovato in lista (layout cambiato?). Cache preservata (${existing.posts.length} post).`);
      return;
    }

    console.log(`${queue.length} articoli in lista. Leggo i corpi...`);
    const found = new Map<string, ArcaPost>();
    for (const a of queue) {
      try {
        await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch { continue; }
      if (await isBlocked(page)) break;
      // arca.live popola il corpo via JS DOPO il domcontentloaded: attendere il container reale
      // (.article-content) prima di leggere, altrimenti si legge una pagina vuota.
      await page.waitForSelector('.article-content', { timeout: 15000 }).catch(() => {});
      const body = (await page.locator('.article-content').first().innerText().catch(() => '')) || '';
      const comments = (await page
        .$$eval('.comment-item .message', (els: any[]) => els.map((e) => (e.innerText || '').trim()))
        .catch(() => [])) as string[];
      const text = [body.trim(), ...comments.filter((c) => c.length > 4)].join('\n').slice(0, 6000);
      if (text.length > 30) found.set(a.id, { id: a.id, title: a.title, body: text, url: a.url, date: today() });
      await sleep(1500);
    }

    if (found.size === 0) {
      console.log('0 articoli con contenuto utile. Cache invariata.');
      return;
    }

    // merge non distruttivo, tieni i più recenti per id (id arca crescente = più recente)
    const merged = new Map<string, ArcaPost>();
    for (const p of existing.posts) merged.set(p.id, p);
    for (const [id, p] of found) merged.set(id, p);
    const top = [...merged.values()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, KEEP_TOP);

    writeFileSync(CACHE_PATH, JSON.stringify({ lastScraped: today(), posts: top }, null, 2));
    console.log(`\nSalvati ${top.length} post in ${CACHE_PATH} (${found.size} nuovi/aggiornati).`);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error('scrape-arca fallito:', e.message); });
