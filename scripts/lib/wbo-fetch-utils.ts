/**
 * wbo-fetch-utils.ts — Funzioni pure di fetch-wbo.ts, senza Playwright, così hanno un golden test
 * (scripts/test-wbo-fetch.ts). Qui vive il giudizio «la pagina letta è davvero il thread?», che il
 * fetcher non aveva: dal 06/08 al 26/09/2026, 38 run su 52 hanno letto «ultima pagina = 1» su un
 * thread di 155 pagine, perché il documento veniva letto subito dopo la challenge Cloudflare, prima
 * che il thread fosse renderizzato.
 */

/** Estrae il numero di pagina massimo dal markup di paginazione MyBB. 1 se non trovato. */
export function maxPageFrom(html: string): number {
  let max = 1;
  for (const m of html.matchAll(/[?&]page=(\d+)/g)) max = Math.max(max, parseInt(m[1], 10));
  const pm = html.match(/Pages\s*\((\d+)\)/i);
  if (pm) max = Math.max(max, parseInt(pm[1], 10));
  return max;
}

const toIso = (mm: string, dd: string, yyyy: string) => `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

/** Data ISO più recente trovata nel raw: campi evento "Date: MM/DD/YYYY" e timestamp MyBB MM-DD-YYYY. */
export function newestIso(raw: string): string | null {
  let best: string | null = null;
  const consider = (iso: string) => { if (!best || iso > best) best = iso; };
  for (const m of raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) consider(toIso(m[1], m[2], m[3]));
  for (const m of raw.matchAll(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/g)) consider(toIso(m[1], m[2], m[3]));
  return best;
}

/**
 * Il testo è una pagina-thread MyBB renderizzata? Il marcatore è «Subscribe to this thread», presente
 * su tutte le 88 pagine in cache sul server (misurato il 26/09/2026) e assente sia nella challenge
 * Cloudflare («Just a moment…» / «Ci siamo quasi…») sia nel documento intermedio che il browser mostra
 * fra la challenge e il thread.
 */
export function looksLikeThread(text: string): boolean {
  return /subscribe to this thread/i.test(text);
}

/**
 * Un numero di pagina appena letto è credibile solo se non arretra rispetto alla frontiera già in
 * cache: un thread MyBB cresce soltanto. «1» dopo 155 non è un thread accorciato, è una pagina letta
 * male. Alla prima esecuzione (frontiera 0) qualsiasi valore ≥ 1 va bene.
 */
export function isPlausibleLastPage(found: number, frontier: number): boolean {
  if (!Number.isFinite(found) || found < 1) return false;
  return found >= frontier;
}

/** Pagina massima presente in cache (0 se la cache è vuota). Le chiavi di `pages` sono numeri come stringhe. */
export function cacheFrontier(pages: Record<string, unknown> | undefined): number {
  let max = 0;
  for (const k of Object.keys(pages ?? {})) {
    const n = parseInt(k, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** Pagina minima presente in cache (0 se vuota): da qui in giù riprende il backfill storico. */
export function cacheFloor(pages: Record<string, unknown> | undefined): number {
  let min = 0;
  for (const k of Object.keys(pages ?? {})) {
    const n = parseInt(k, 10);
    if (Number.isFinite(n) && (min === 0 || n < min)) min = n;
  }
  return min;
}

/** Numero di pagina nell'URL finale di un atterraggio (`?page=N`), null se assente. */
export function pageFromUrl(url: string): number | null {
  const m = url.match(/[?&]page=(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
