/**
 * scrape-reddit.ts — Raccoglie i post r/Beyblade su combo competitive (cache grezza).
 *
 * Solo API ufficiale di Reddit. Le regole di Reddit (Responsible Builder Policy, lette il
 * 12/11/2026) chiedono un'approvazione esplicita prima di ogni accesso ai dati via API e vietano
 * la raccolta automatica senza approvazione: la vecchia via, un browser loggato pilotato da
 * Playwright, è stata tolta per questo.
 *
 * Lo script lavora solo se nel `.env` o nell'ambiente ci sono REDDIT_CLIENT_ID,
 * REDDIT_CLIENT_SECRET e REDDIT_USERNAME, cioè le credenziali di un'app approvata da Reddit.
 * Chiede un token con il grant `client_credentials` e legge ricerca e commenti su
 * oauth.reddit.com. Senza credenziali non contatta Reddit: stampa che la fonte è spenta ed esce 0.
 * La parte OAuth è scritta sulla documentazione archiviata di Reddit (2016) e non è ancora stata
 * provata con credenziali vere.
 *
 * Non distruttivo: in caso di errore o di zero risultati preserva la cache; i post nuovi vengono
 * uniti agli esistenti (dedup per id). Lo schema cache resta { lastScraped, posts }.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_PATH = join(ROOT, 'data', 'reddit-cache.json');
// Backfill storico (one-off): pagina a fondo tutte le query (cursore `after`, fino a ~1000/query, il
// limite di Reddit) e NON applica KEEP_TOP (tiene tutto). Va seguito SUBITO da /update-combos, prima
// che un run normale (KEEP_TOP) poti la cache. Marcia normale: REDDIT_BACKFILL non settato.
const BACKFILL = process.env.REDDIT_BACKFILL === '1';
const KEEP_TOP = 150;
const MAX_PAGES = BACKFILL ? 15 : 1;
// Query orientate ai risultati di torneo. Il giudizio "ha davvero vinto / è in top cut" lo fa l'IA
// in /update-combos: qui si raccoglie grezzo, ampio e non filtrato. Recall misurato (16/06/2026):
// le 5 query danno 401 post distinti; `tourney` da solo ne porta 97 unici (~24%), quasi disgiunto
// dalle altre → tenuto. Ogni query (tranne `top cut`) satura il cap Reddit di 100.
const QUERIES = ['tournament', 'tourney', 'won', 'winning', 'top cut'];

interface RedditPost { id: string; title: string; body: string; url: string; score: number; date: string; comments: string[]; }
interface RedditCache { lastScraped: string; posts: RedditPost[]; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function loadCache(): RedditCache {
  if (!existsSync(CACHE_PATH)) return { lastScraped: '', posts: [] };
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); } catch { return { lastScraped: '', posts: [] }; }
}

// ---- API ufficiale ----
interface CredApi { id: string; secret: string; user: string }

function credenzialiApi(): CredApi | null {
  const env: Record<string, string> = {};
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const riga of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = riga.match(/^\s*(REDDIT_[A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const leggiVar = (k: string) => (process.env[k] ?? env[k] ?? '').trim();
  const c = { id: leggiVar('REDDIT_CLIENT_ID'), secret: leggiVar('REDDIT_CLIENT_SECRET'), user: leggiVar('REDDIT_USERNAME') };
  return c.id && c.secret && c.user ? c : null;
}

/** Reddit chiede uno User-Agent che dica chi è il client: mai quello di un browser. */
const userAgent = (c: CredApi) => `windows:beyblade-x-combo-finder:v1.0 (by /u/${c.user})`;

async function tokenApi(c: CredApi): Promise<string> {
  const r = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${c.id}:${c.secret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent(c),
    },
    body: 'grant_type=client_credentials',
  });
  const corpo = await r.text();
  let j: any = null;
  try { j = JSON.parse(corpo); } catch { /* non JSON */ }
  // Il corpo dell'errore non contiene il secret: si può stampare. Il token no, e non si stampa.
  if (!r.ok || !j?.access_token) throw new Error(`token rifiutato: HTTP ${r.status} ${corpo.slice(0, 200)}`);
  return j.access_token;
}

/** L'url www.reddit.com/….json diventa oauth.reddit.com/… col token. {__blocked:true} su 401/403/429, null sugli altri errori. */
function lettoreApi(c: CredApi, token: string): (url: string) => Promise<any> {
  return async (url: string) => {
    const u = new URL(url);
    u.host = 'oauth.reddit.com';
    u.pathname = u.pathname.replace(/\.json$/, '');
    u.searchParams.set('raw_json', '1');
    try {
      const r = await fetch(u, { headers: { authorization: `Bearer ${token}`, 'user-agent': userAgent(c) } });
      if (r.status === 401 || r.status === 403 || r.status === 429) {
        console.error(`  API Reddit: HTTP ${r.status} su ${u.pathname}`);
        return { __blocked: true };
      }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  };
}

// Le credenziali funzionano se una ricerca rende risultati.
async function loggedIn(leggi: (url: string) => Promise<any>): Promise<boolean> {
  const d = await leggi('https://www.reddit.com/r/Beyblade/search.json?q=beyblade&restrict_sr=on&sort=top&t=all&limit=5');
  return !!(d && !d.__blocked && d.data?.children?.length);
}

function toPost(d: any): RedditPost {
  return {
    id: d.id, title: d.title ?? '', body: d.selftext ?? '',
    url: `https://reddit.com${d.permalink}`, score: d.score ?? 0,
    date: new Date((d.created_utc ?? 0) * 1000).toISOString().slice(0, 10), comments: [],
  };
}

// Con le credenziali presenti ogni fallimento deve arrivare alla raccolta come errore: quando lo
// script usciva sempre 0, un mese senza post è rimasto invisibile (14/10 - 12/11/2026).
function fallito(msg: string): void {
  console.error(msg);
  process.exitCode = 2;
}

async function main() {
  const cred = credenzialiApi();
  if (!cred) {
    console.log('Reddit: fonte spenta, mancano le credenziali API (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME). Cache invariata.');
    return;
  }
  console.log('Reddit scraper r/Beyblade (API ufficiale)\n');
  const existing = loadCache();
  const leggi = lettoreApi(cred, await tokenApi(cred));

  {
    if (!(await loggedIn(leggi))) {
      fallito(`L'API Reddit non restituisce risultati con queste credenziali. Cache preservata (${existing.posts.length} post).`);
      return;
    }

    const found = new Map<string, RedditPost>();
    let blockedFirst = false, anyOk = false;
    outer:
    for (const q of QUERIES) {
      console.log(`  Cerco: "${q}"`);
      let after = '';
      for (let p = 0; p < MAX_PAGES; p++) {
        const params = new URLSearchParams({ q, restrict_sr: 'on', sort: 'new', limit: '100' });
        if (after) params.set('after', after);
        const data = await leggi(`https://www.reddit.com/r/Beyblade/search.json?${params}`);
        if (data?.__blocked) { if (!anyOk) blockedFirst = true; break outer; }
        const children = data?.data?.children ?? [];
        if (children.length) {
          anyOk = true;
          for (const c of children) {
            const d = c.data;
            if (d && (d.selftext || d.title) && !found.has(d.id)) found.set(d.id, toPost(d));
          }
        }
        after = data?.data?.after ?? '';
        if (BACKFILL) console.log(`    pagina ${p + 1}: +${children.length} (tot ${found.size})`);
        if (!after || !children.length) break;
        await sleep(2000);
      }
      await sleep(2000);
    }

    if (blockedFirst) {
      fallito(`L'API Reddit ha rifiutato la prima ricerca. Cache preservata (${existing.posts.length} post).`);
      return;
    }
    if (!anyOk) {
      fallito(`Nessuna risposta utile dall'API Reddit. Cache preservata (${existing.posts.length} post).`);
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
    const sorted = [...merged.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    const top = BACKFILL ? sorted : sorted.slice(0, KEEP_TOP);

    const toFetch = top.filter((p) => !p.comments.length && found.has(p.id));
    console.log(`\n${found.size} post trovati, ${top.length} in cache. Recupero commenti per ${toFetch.length}...`);
    let done = 0;
    for (const p of top) {
      if (p.comments.length || !found.has(p.id)) continue;
      const c = await leggi(`https://www.reddit.com/r/Beyblade/comments/${p.id}.json?sort=top&limit=100`);
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
      if (BACKFILL && ++done % 25 === 0) console.log(`    commenti ${done}/${toFetch.length}`);
      await sleep(2000);
    }

    writeFileSync(CACHE_PATH, JSON.stringify({ lastScraped: new Date().toISOString().slice(0, 10), posts: top }, null, 2));
    console.log(`\nSalvati ${top.length} post in ${CACHE_PATH}`);
  }
}

main().catch((e) => { console.error('scrape-reddit fallito:', e.message); process.exitCode = 2; });
