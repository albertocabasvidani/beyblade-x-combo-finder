/**
 * scrape-reddit.ts — Raccoglie i post r/Beyblade su combo competitive (cache grezza), via Bright Data.
 *
 * Lo script non contatta Reddit. Chiede a Bright Data (Reddit Scraper API, «Posts, Discover by
 * subreddit URL») gli ultimi post del subreddit e li riceve già strutturati, commenti compresi.
 * Reddit ha negato l'accesso alla propria API il 12/11/2026 e le sue regole vietano la raccolta
 * diretta: un browser pilotato o un'app OAuth non sono più strade di questo script.
 *
 * Una raccolta dura decine di minuti (misurato il 13/11/2026: 47 minuti per 100 post), quindi il
 * lavoro è in due tempi, uno per notte:
 *   1. si ritira il risultato della richiesta lanciata nel giro precedente e lo si fonde in cache;
 *   2. si lancia la richiesta nuova, che verrà ritirata al giro dopo.
 * I post entrano quindi in cache con un giorno di ritardo. Lo stato fra i due tempi sta in
 * `data/reddit-bd-state.json`.
 *
 * Bright Data non sa cercare dentro un solo subreddit, quindi arrivano tutti i post e il filtro
 * sulle parole di torneo lo fa questo script, su titolo e testo. È lo stesso filtro che prima
 * faceva la ricerca di Reddit: decide solo cosa mettere in cache, il giudizio su cosa è una combo
 * resta a /mine-reddit. Misurato il 13/11/2026: 7 post su 100 lo passano.
 *
 * Costo: un credito per post (i commenti stanno nello stesso record). La quota gratuita è di 5.000
 * crediti al mese; r/Beyblade ha circa 52 post al giorno, e con 70 post per notte sono 2.100
 * crediti. `TETTO_MENSILE` ferma i lanci prima della quota, perché un account con fondi caricati
 * oltre la quota paga.
 *
 * Senza BRIGHTDATA_API_KEY (nel `.env` o nell'ambiente) la fonte è spenta: lo script lo dice ed
 * esce 0. Con la chiave, ogni fallimento esce 2. Non distruttivo: la cache si riscrive solo quando
 * ci sono post nuovi, uniti agli esistenti per id.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_PATH = join(ROOT, 'data', 'reddit-cache.json');
const STATE_PATH = join(ROOT, 'data', 'reddit-bd-state.json');
const DATASET_POSTS = 'gd_lvz8ah06191smkebj4';
const API = 'https://api.brightdata.com/datasets/v3';
const SUBREDDIT_URL = 'https://www.reddit.com/r/Beyblade/';
const KEEP_TOP = 150;
const TETTO_MENSILE = 4500;
const ORE_MASSIME_IN_CORSO = 24;
const POST_PER_GIRO = (() => {
  const n = parseInt(process.env.REDDIT_BD_LIMIT ?? '', 10);
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 70;
})();

// Le stesse parole delle vecchie ricerche su Reddit (tournament, tourney, won, winning, top cut).
const PAROLE_TORNEO = /\b(tournaments?|tourneys?|won|winning|top[- ]cut)\b/i;

export interface RedditPost { id: string; title: string; body: string; url: string; score: number; date: string; comments: string[]; }
interface RedditCache { lastScraped: string; posts: RedditPost[]; }
interface Stato {
  pending?: { snapshotId: string; triggeredAt: string; limit: number };
  crediti?: Record<string, number>;
  lastOk?: string;
}

const adesso = () => new Date().toISOString();
const mese = () => adesso().slice(0, 7);

function leggiJson<T>(p: string, fb: T): T {
  if (!existsSync(p)) return fb;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return fb; }
}

function chiave(): string {
  if (process.env.BRIGHTDATA_API_KEY) return process.env.BRIGHTDATA_API_KEY.trim();
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return '';
  const m = readFileSync(envPath, 'utf-8').match(/^\s*BRIGHTDATA_API_KEY\s*=\s*(.*?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
}

/** Un record Bright Data nel formato della cache. `null` se non è un post utilizzabile. */
export function daRecord(x: any): RedditPost | null {
  const id = String(x?.post_id ?? '').replace(/^t3_/, '');
  if (!id || !x?.url) return null;
  // La pagina di Reddit lascia l'etichetta «Read more» in coda al testo: non fa parte del post.
  const body = String(x.description ?? '').replace(/\s*Read more\s*$/, '').trim();
  const comments: string[] = [];
  const aggiungi = (t: unknown) => { const s = String(t ?? '').trim(); if (s.length > 20) comments.push(s.slice(0, 500)); };
  for (const c of Array.isArray(x.comments) ? x.comments : []) {
    aggiungi(c?.comment);
    for (const r of Array.isArray(c?.replies) ? c.replies : []) aggiungi(r?.reply);
  }
  return {
    id,
    title: String(x.title ?? ''),
    body,
    url: String(x.url),
    score: Number(x.num_upvotes) || 0,
    date: String(x.date_posted ?? '').slice(0, 10),
    comments: comments.slice(0, 80),
  };
}

export const parlaDiTorneo = (p: RedditPost): boolean => PAROLE_TORNEO.test(`${p.title}\n${p.body}`);

/** Fonde in cache i post che passano il filtro. Ritorna i conteggi per il riepilogo. */
export function fondi(records: any[]): { ricevuti: number; rilevanti: number; nuovi: number; inCache: number } {
  const cache = leggiJson<RedditCache>(CACHE_PATH, { lastScraped: '', posts: [] });
  const merged = new Map<string, RedditPost>((cache.posts ?? []).map((p) => [p.id, p]));
  let ricevuti = 0, rilevanti = 0, nuovi = 0;
  for (const x of records) {
    const p = daRecord(x);
    if (!p) continue;
    ricevuti++;
    if (!parlaDiTorneo(p)) continue;
    rilevanti++;
    if (!merged.has(p.id)) nuovi++;
    merged.set(p.id, p);   // un post già in cache si aggiorna: nel frattempo ha raccolto commenti
  }
  const top = [...merged.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, KEEP_TOP);
  if (rilevanti > 0) writeFileSync(CACHE_PATH, JSON.stringify({ lastScraped: adesso().slice(0, 10), posts: top }, null, 2));
  return { ricevuti, rilevanti, nuovi, inCache: top.length };
}

class Fallimento extends Error {}

async function chiama(key: string, url: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  // La risposta non contiene la chiave, ma si toglie comunque prima di poterla stampare.
  return { status: r.status, text: (await r.text()).split(key).join('<chiave>') };
}

/** Primo tempo: ritira la richiesta del giro precedente. Ritorna la frase per il riepilogo. */
async function ritira(key: string, stato: Stato): Promise<string> {
  const pend = stato.pending;
  if (!pend) return 'nessuna richiesta da ritirare';
  const p = await chiama(key, `${API}/progress/${pend.snapshotId}`);
  let j: any = {};
  try { j = JSON.parse(p.text); } catch { /* non JSON */ }
  if (p.status !== 200 || !j.status) throw new Fallimento(`stato della richiesta ${pend.snapshotId} illeggibile: HTTP ${p.status} ${p.text.slice(0, 200)}`);
  if (j.status === 'running') {
    const ore = (Date.now() - Date.parse(pend.triggeredAt)) / 36e5;
    if (ore > ORE_MASSIME_IN_CORSO) {
      delete stato.pending;
      throw new Fallimento(`la richiesta ${pend.snapshotId} è in corso da ${ore.toFixed(0)} ore: abbandonata`);
    }
    return `richiesta del ${pend.triggeredAt.slice(0, 16)} ancora in corso`;
  }
  if (j.status !== 'ready') {
    delete stato.pending;
    throw new Fallimento(`la richiesta ${pend.snapshotId} è finita con stato «${j.status}»`);
  }
  const s = await chiama(key, `${API}/snapshot/${pend.snapshotId}?format=json`);
  let records: any[];
  try { records = JSON.parse(s.text); } catch { throw new Fallimento(`risultato non leggibile: HTTP ${s.status} ${s.text.slice(0, 200)}`); }
  if (!Array.isArray(records)) throw new Fallimento(`risultato inatteso: ${s.text.slice(0, 200)}`);
  const esito = fondi(records);
  stato.crediti = stato.crediti ?? {};
  const m = pend.triggeredAt.slice(0, 7);
  stato.crediti[m] = (stato.crediti[m] ?? 0) + records.length;
  delete stato.pending;
  if (esito.ricevuti === 0) throw new Fallimento(`la richiesta ${pend.snapshotId} non ha restituito post`);
  stato.lastOk = adesso();
  return `${esito.ricevuti} post ricevuti, ${esito.rilevanti} di torneo, ${esito.nuovi} nuovi, ${esito.inCache} in cache`;
}

/** Secondo tempo: lancia la richiesta che verrà ritirata al giro dopo. */
async function lancia(key: string, stato: Stato): Promise<string> {
  if (stato.pending) return 'nessun lancio nuovo';
  const usati = stato.crediti?.[mese()] ?? 0;
  if (usati + POST_PER_GIRO > TETTO_MENSILE) return `tetto mensile raggiunto (${usati} crediti su ${TETTO_MENSILE}), nessun lancio`;
  const url = `${API}/trigger?dataset_id=${DATASET_POSTS}&type=discover_new&discover_by=subreddit_url&limit_per_input=${POST_PER_GIRO}`;
  const r = await chiama(key, url, { method: 'POST', body: JSON.stringify([{ url: SUBREDDIT_URL, sort_by: 'New' }]) });
  let j: any = {};
  try { j = JSON.parse(r.text); } catch { /* non JSON */ }
  if (r.status !== 200 || !j.snapshot_id) throw new Fallimento(`lancio rifiutato: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  stato.pending = { snapshotId: j.snapshot_id, triggeredAt: adesso(), limit: POST_PER_GIRO };
  return `lanciata la richiesta di ${POST_PER_GIRO} post (${usati} crediti usati nel mese)`;
}

async function main() {
  const key = chiave();
  if (!key) {
    console.log('Reddit: fonte spenta, manca BRIGHTDATA_API_KEY. Cache invariata.');
    return;
  }
  const stato = leggiJson<Stato>(STATE_PATH, {});
  const parti: string[] = [];
  let errore = '';
  try {
    parti.push(await ritira(key, stato));
    parti.push(await lancia(key, stato));
  } catch (e: any) {
    if (!(e instanceof Fallimento)) throw e;
    errore = e.message;
    // Un ritiro fallito non deve fermare il lancio: altrimenti un guasto costa due notti.
    if (!stato.pending) {
      try { parti.push(await lancia(key, stato)); } catch (e2: any) { errore += ` | ${e2?.message ?? e2}`; }
    }
  } finally {
    writeFileSync(STATE_PATH, JSON.stringify(stato, null, 2));
  }
  // Una sola riga che comincia per «Reddit:»: è quella che collect-sources ristampa nel riepilogo.
  if (errore) {
    console.error(`Reddit: FALLITO: ${errore}${parti.length ? ` | ${parti.join(' | ')}` : ''}`);
    process.exitCode = 2;
  } else {
    console.log(`Reddit: ${parti.join(' | ')}`);
  }
}

if (process.argv[1] && /scrape-reddit\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error('scrape-reddit fallito:', e?.message ?? e); process.exitCode = 2; });
}
