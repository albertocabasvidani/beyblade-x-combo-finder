/**
 * scrape-reddit.ts — Raccoglie i post r/Beyblade su combo competitive (cache grezza).
 *
 * Reddit blocca l'accesso non autenticato a old.reddit.com e www.reddit.com/.json
 * ("blocked by network security"). Serve l'API ufficiale OAuth: crea un'app "script" su
 * https://www.reddit.com/prefs/apps e metti in .env REDDIT_CLIENT_ID e REDDIT_CLIENT_SECRET
 * (flusso app-only client_credentials, sola lettura — niente username/password).
 *
 * Non distruttivo: in assenza di credenziali o in caso di errore NON sovrascrive la cache
 * esistente. I post nuovi vengono uniti a quelli già presenti (dedup per id).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const CACHE_PATH = join(DATA_DIR, 'reddit-cache.json');
const ENV_PATH = join(ROOT, '.env');
const USER_AGENT = 'windows:beyblade-combo-finder:v1.0 (by /u/beyblade-research)';
const DELAY_MS = 2000;
const KEEP_TOP = 30;

interface RedditPost {
  id: string;
  title: string;
  body: string;
  url: string;
  score: number;
  date: string;
  comments: string[];
}
interface RedditCache {
  lastScraped: string;
  posts: RedditPost[];
}

const QUERIES = ['best combos', 'meta combos', 'competitive deck', 'tournament winning', 'top tier combo'];

function readEnv(key: string): string | null {
  if (!existsSync(ENV_PATH)) return null;
  const m = readFileSync(ENV_PATH, 'utf-8').match(new RegExp('^' + key + '=(.+)$', 'm'));
  return m ? m[1].trim() : null;
}

function loadCache(): RedditCache {
  if (!existsSync(CACHE_PATH)) return { lastScraped: '', posts: [] };
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); } catch { return { lastScraped: '', posts: [] }; }
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function getToken(id: string, secret: string): Promise<string> {
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  if (!j.access_token) throw new Error('nessun access_token nella risposta');
  return j.access_token;
}

async function api(path: string, token: string): Promise<any> {
  const res = await fetch('https://oauth.reddit.com' + path, {
    headers: { Authorization: `bearer ${token}`, 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

async function searchPosts(query: string, token: string): Promise<RedditPost[]> {
  const params = new URLSearchParams({ q: query, restrict_sr: 'on', sort: 'top', t: 'year', limit: '10' });
  console.log(`  Cerco: "${query}"`);
  const data = await api(`/r/Beyblade/search?${params}`, token);
  const posts: RedditPost[] = [];
  for (const child of data?.data?.children ?? []) {
    const p = child.data;
    if (!p.selftext && !p.title) continue;
    posts.push({
      id: p.id,
      title: p.title ?? '',
      body: p.selftext ?? '',
      url: `https://reddit.com${p.permalink}`,
      score: p.score ?? 0,
      date: new Date((p.created_utc ?? 0) * 1000).toISOString().slice(0, 10),
      comments: [],
    });
  }
  return posts;
}

async function fetchTopComments(postId: string, token: string): Promise<string[]> {
  const data = await api(`/r/Beyblade/comments/${postId}?sort=top&limit=5`, token);
  const out: string[] = [];
  for (const child of data?.[1]?.data?.children ?? []) {
    if (child.kind !== 't1') continue;
    const body = child.data?.body ?? '';
    if (body.length > 20) out.push(body.slice(0, 500));
  }
  return out;
}

async function main() {
  console.log('Reddit scraper r/Beyblade (OAuth)\n=================================\n');
  const existing = loadCache();

  const id = readEnv('REDDIT_CLIENT_ID');
  const secret = readEnv('REDDIT_CLIENT_SECRET');
  if (!id || !secret) {
    console.warn('REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET assenti in .env — Reddit richiede OAuth.');
    console.warn('Crea un\'app "script" su https://www.reddit.com/prefs/apps e aggiungi le due chiavi al .env.');
    console.warn(`Cache esistente preservata (${existing.posts.length} post). Nessuna modifica.`);
    return;
  }

  let token: string;
  try {
    token = await getToken(id, secret);
  } catch (e) {
    console.error(`OAuth fallito: ${(e as Error).message}`);
    console.error(`Cache esistente preservata (${existing.posts.length} post). Nessuna modifica.`);
    return;
  }

  const found = new Map<string, RedditPost>();
  let anySuccess = false;
  for (const q of QUERIES) {
    try {
      for (const p of await searchPosts(q, token)) if (!found.has(p.id)) found.set(p.id, p);
      anySuccess = true;
    } catch (e) {
      console.error(`  Errore ricerca "${q}": ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  if (!anySuccess) {
    console.error(`Tutte le ricerche fallite. Cache esistente preservata (${existing.posts.length} post).`);
    return;
  }

  // Merge non distruttivo: post esistenti + nuovi, dedup per id
  const merged = new Map<string, RedditPost>();
  for (const p of existing.posts) merged.set(p.id, p);
  for (const [pid, p] of found) merged.set(pid, p); // i nuovi sovrascrivono (score/commenti aggiornati)

  const top = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, KEEP_TOP);

  console.log(`\n${found.size} post trovati, ${top.length} in cache dopo il merge. Recupero commenti dei nuovi...\n`);
  for (const p of top) {
    if (p.comments.length || !found.has(p.id)) continue; // commenti solo per i nuovi senza commenti
    try {
      p.comments = await fetchTopComments(p.id, token);
    } catch (e) {
      console.error(`  Errore commenti ${p.id}: ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  const cache: RedditCache = { lastScraped: new Date().toISOString().slice(0, 10), posts: top };
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`\nSalvati ${top.length} post in ${CACHE_PATH}`);
}

main().catch((e) => { console.error('scrape-reddit fallito:', e.message); });
