/**
 * scrape-reddit.ts — Raccoglie i post r/Beyblade su combo competitive (cache grezza).
 *
 * Reddit blocca l'accesso NON autenticato a livello edge ("blocked by network security"): curl,
 * headless e perfino .json restituiscono pagina di blocco o listing vuoto. Strada scelta: browser
 * reale loggato. Si usa Playwright col Chrome di sistema e un profilo persistente in cui l'utente fa
 * login UNA volta; il fetcher gira headed (REDDIT_HEADED=1, come WBO) e legge gli endpoint .json
 * autenticati (estrazione pulita, niente DOM scraping). Lo schema cache resta { lastScraped, posts }.
 *
 * Modalità:
 *  - REDDIT_HEADED=1 npm run scrape:reddit  → headed, riusa il login del profilo (se non loggato,
 *    attende che l'utente entri, fino a 3 min). È il modo che funziona.
 *  - npm run scrape:reddit (headless, es. da collect:sources/scheduler) → quasi sempre bloccato:
 *    NON sovrascrive la cache, esce come no-op.
 *
 * Non distruttivo: in caso di blocco/errore/0 risultati preserva la cache; i post nuovi vengono
 * uniti agli esistenti (dedup per id).
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_PATH = join(ROOT, 'data', 'reddit-cache.json');
const USER_DIR = 'C:/Users/cinqu/.playwright-beyblade';
const HEADED = process.env.REDDIT_HEADED === '1';
const KEEP_TOP = 150;
const BLOCK = /blocked by network security|whoa there|too many requests|just a moment/i;
// Query orientate ai risultati di torneo. Il giudizio "ha davvero vinto / è in top cut" lo fa l'IA
// in /update-combos: qui si raccoglie grezzo, ampio e non filtrato. `tourney` è incluso in via
// sperimentale (verificarne la resa dopo il primo run headed; rimuoverlo se pesca poco).
const QUERIES = ['tournament', 'tourney', 'won', 'winning', 'top cut'];

interface RedditPost { id: string; title: string; body: string; url: string; score: number; date: string; comments: string[]; }
interface RedditCache { lastScraped: string; posts: RedditPost[]; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function loadCache(): RedditCache {
  if (!existsSync(CACHE_PATH)) return { lastScraped: '', posts: [] };
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); } catch { return { lastScraped: '', posts: [] }; }
}

// Naviga a un endpoint .json e ne fa il parse dal body. {__blocked:true} se WAF, null se non-JSON.
async function getJson(page: any, url: string): Promise<any> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const text = (await page.locator('body').innerText().catch(() => '')) || '';
  if (BLOCK.test(text.slice(0, 400))) return { __blocked: true };
  try { return JSON.parse(text); } catch { return null; }
}

// "Loggato" = una ricerca autenticata rende risultati (ground truth: la sessione a cookie del profilo
// abilita search.json). Niente OAuth /api/v1/me.json (richiede bearer, non i cookie del browser).
async function loggedIn(page: any): Promise<boolean> {
  const d = await getJson(page, 'https://www.reddit.com/r/Beyblade/search.json?q=beyblade&restrict_sr=on&sort=top&t=all&limit=5');
  return !!(d && !d.__blocked && d.data?.children?.length);
}

function toPost(d: any): RedditPost {
  return {
    id: d.id, title: d.title ?? '', body: d.selftext ?? '',
    url: `https://reddit.com${d.permalink}`, score: d.score ?? 0,
    date: new Date((d.created_utc ?? 0) * 1000).toISOString().slice(0, 10), comments: [],
  };
}

async function main() {
  console.log(`Reddit scraper r/Beyblade (browser ${HEADED ? 'headed' : 'headless'})\n`);
  const existing = loadCache();

  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    channel: 'chrome', headless: !HEADED, chromiumSandbox: true,
    ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  try {
    if (HEADED && !(await loggedIn(page))) {
      console.log('Sessione Reddit non attiva. Apro reddit.com: fai login nella finestra (attendo fino a 3 min)...');
      await page.goto('https://www.reddit.com/login/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      const start = Date.now();
      let ok = false;
      while (Date.now() - start < 180_000) {
        await sleep(8000);
        if (await loggedIn(page)) { ok = true; console.log('Login rilevato.'); break; }
      }
      if (!ok) { console.error(`Login non completato. Cache preservata (${existing.posts.length} post).`); return; }
    }

    const found = new Map<string, RedditPost>();
    let blockedFirst = false, anyOk = false;
    for (const q of QUERIES) {
      const params = new URLSearchParams({ q, restrict_sr: 'on', sort: 'new', limit: '100' });
      console.log(`  Cerco: "${q}"`);
      const data = await getJson(page, `https://www.reddit.com/r/Beyblade/search.json?${params}`);
      if (data?.__blocked) { if (!anyOk) blockedFirst = true; break; }
      if (data?.data?.children) {
        anyOk = true;
        for (const c of data.data.children) {
          const d = c.data;
          if (d && (d.selftext || d.title) && !found.has(d.id)) found.set(d.id, toPost(d));
        }
      }
      await sleep(2000);
    }

    if (blockedFirst) {
      console.error('Bloccato dal WAF di Reddit (headless). Usa REDDIT_HEADED=1 con login. Cache preservata.');
      return;
    }
    if (!anyOk) {
      console.error(`Nessuna risposta utile (probabile sessione non loggata). Cache preservata (${existing.posts.length} post).`);
      return;
    }
    if (found.size === 0) {
      console.log('0 nuovi post dalle ricerche. Cache invariata.');
      return;
    }

    // merge non distruttivo
    const merged = new Map<string, RedditPost>();
    for (const p of existing.posts) merged.set(p.id, p);
    for (const [id, p] of found) merged.set(id, p);
    const top = [...merged.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, KEEP_TOP);

    console.log(`\n${found.size} post trovati, ${top.length} in cache. Recupero commenti dei nuovi...`);
    for (const p of top) {
      if (p.comments.length || !found.has(p.id)) continue;
      const c = await getJson(page, `https://www.reddit.com/r/Beyblade/comments/${p.id}.json?sort=top&limit=100`);
      // Tutti i commenti, anche annidati (flatten ricorsivo): un torneo si discute nelle risposte.
      const flat: string[] = [];
      const walk = (nodes: any[]) => {
        for (const x of nodes ?? []) {
          if (x.kind !== 't1') continue;
          const body = x.data?.body ?? '';
          if (body.length > 20) flat.push(body.slice(0, 500));
          const replies = x.data?.replies;
          if (replies && typeof replies === 'object') walk(replies.data?.children ?? []);
        }
      };
      walk(c?.[1]?.data?.children ?? []);
      p.comments = flat.slice(0, 80);
      await sleep(2000);
    }

    writeFileSync(CACHE_PATH, JSON.stringify({ lastScraped: new Date().toISOString().slice(0, 10), posts: top }, null, 2));
    console.log(`\nSalvati ${top.length} post in ${CACHE_PATH}`);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error('scrape-reddit fallito:', e.message); });
