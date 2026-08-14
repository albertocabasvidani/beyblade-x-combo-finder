/**
 * lib/wiki.ts — Client MediaWiki condiviso per Beyblade Fandom.
 *
 * Nasce per togliere dalle mani dell'IA il lavoro deterministico che prima improvvisava a ogni
 * run di /update-parts: normalizzare i titoli, risolvere i redirect, leggere i revid. Usato da
 * scan-wiki-updates.ts; verify-against-wiki.ts e enrich-stats.ts hanno ancora le loro copie
 * private di apiGet (non toccate, per non rischiare il daily su un refactor cosmetico).
 *
 * Due fatti dell'API verificati sul campo, entrambi controintuitivi:
 *  - `action=parse` NON restituisce `revid` su questo Fandom. Il revid arriva SEMPRE da
 *    batchQuery (action=query), e il wikitext si scarica per `oldid`, non per `page`: cosi'
 *    il testo letto e' esattamente la revisione che il diff ha visto (niente TOCTOU se
 *    qualcuno edita la pagina a meta' run).
 *  - Le pagine con nome Hasbro sono #REDIRECT a quelle Takara Tomy (e per le parti a volte il
 *    contrario). Senza `redirects=1` il batch restituisce il revid dello STUB, che cambia quasi
 *    mai: e' il motivo per cui DranSword_3-60F e Sword_Dran_3-60F convivevano in scan-history
 *    con revid diversi, e la pagina vera restava sotto-scansionata.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';

export const API = 'https://beyblade.fandom.com/api.php';
export const WIKI = 'https://beyblade.fandom.com/wiki/';
const UA = 'beyblade-x-combo-finder wiki-scan (daily parts diff)';
const THROTTLE_MS = 200;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Titolo canonico -> URL /wiki/ (spazi in underscore, come li scrive Fandom). */
export const titleToUrl = (title: string) => WIKI + encodeURI(title.replace(/ /g, '_'));

/** Nome file sicuro su Windows: i titoli contengono ':' e '&' (es. "Beyblade X: Evobattle"). */
export const sanitizeFilename = (title: string) => title.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Estrae il titolo da una chiave di scan-history. Tre forme convivono la' dentro:
 * URL /wiki/, URL api.php?...&page=..., e URL esterni (beybase, WBO: appartengono a
 * /update-combos, che li deduplica per contentHash) -> null, da lasciar stare.
 */
export function titleFromKey(key: string): string | null {
  if (!key.includes('beyblade.fandom.com')) return null;
  try {
    const u = new URL(key);
    const p = u.searchParams.get('page');
    if (p) return decodeURIComponent(p).replace(/_/g, ' ');
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  } catch {
    /* chiave non parsabile come URL: non e' roba nostra */
  }
  return null;
}

export async function apiGet(params: Record<string, string>): Promise<any> {
  const u = new URL(API);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('format', 'json');
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} su ${u}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export type PageInfo =
  | { canonical: string; revid: number; timestamp: string; missing?: false }
  | { canonical: string; revid: null; timestamp: null; missing: true };

/**
 * Revid + timestamp per una lista di titoli, a chunk di 50 (limite dell'API).
 *
 * La mappa e' indicizzata sul titolo RICHIESTO, non su quello canonico: chi chiama deve poter
 * ritrovare cio' che ha chiesto. Per farlo si invertono due mappature nell'ordine in cui
 * MediaWiki le applica: prima `normalized` (underscore -> spazi, maiuscola iniziale), poi
 * `redirects` (titolo -> target). Invertirle al contrario perde le richieste che sono insieme
 * da normalizzare e da redirigere.
 */
export async function batchQuery(titles: string[]): Promise<Map<string, PageInfo>> {
  const out = new Map<string, PageInfo>();
  const uniq = [...new Set(titles.filter(Boolean))];

  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const j = await apiGet({
      action: 'query',
      redirects: '1',
      prop: 'revisions',
      rvprop: 'ids|timestamp',
      titles: batch.join('|'),
    });
    const q = j.query ?? {};

    // richiesto -> normalizzato -> target del redirect
    const normOf = new Map<string, string>();
    for (const n of q.normalized ?? []) normOf.set(n.from, n.to);
    const redirOf = new Map<string, string>();
    for (const r of q.redirects ?? []) redirOf.set(r.from, r.to);

    // titolo finale -> dati della pagina
    const byTitle = new Map<string, any>();
    for (const pg of Object.values<any>(q.pages ?? {})) byTitle.set(pg.title, pg);

    for (const requested of batch) {
      const afterNorm = normOf.get(requested) ?? requested;
      const canonical = redirOf.get(afterNorm) ?? afterNorm;
      const pg = byTitle.get(canonical);
      const rev = pg?.revisions?.[0];
      if (!pg || pg.missing !== undefined || !rev) {
        out.set(requested, { canonical, revid: null, timestamp: null, missing: true });
      } else {
        out.set(requested, { canonical, revid: rev.revid, timestamp: rev.timestamp });
      }
    }
    await sleep(THROTTLE_MS);
  }
  return out;
}

/**
 * Wikitext di una revisione precisa. Si passa per `oldid`: chiedere per `page` scaricherebbe
 * l'ultima revisione, che puo' essere gia' diversa da quella su cui il diff ha deciso.
 */
export async function fetchWikitextAtRev(revid: number): Promise<string> {
  const j = await apiGet({ action: 'parse', oldid: String(revid), prop: 'wikitext' });
  const wt = j.parse?.wikitext?.['*'];
  if (typeof wt !== 'string') throw new Error(`wikitext assente per oldid ${revid}`);
  await sleep(THROTTLE_MS);
  return wt;
}

/** Wikitext per titolo (solo dove il revid non serve, es. fixture di test). */
export async function fetchWikitextByTitle(title: string): Promise<string> {
  const j = await apiGet({ action: 'parse', page: title, prop: 'wikitext' });
  const wt = j.parse?.wikitext?.['*'];
  if (typeof wt !== 'string') throw new Error(`wikitext assente per ${title}`);
  await sleep(THROTTLE_MS);
  return wt;
}

/**
 * Scrittura atomica: tmp + rename. Una worklist scritta a meta' (processo ucciso, pipeline
 * interrotta) verrebbe letta come completa dalla sessione dopo, e le pagine mancanti
 * risulterebbero "gia' viste" senza esserlo mai state.
 */
export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Timestamp in ISO: scan-history ne aveva 3 forme (ISO, epoch numerico, assente). */
export function toIso(v: unknown): string | null {
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
