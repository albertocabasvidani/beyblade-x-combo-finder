/**
 * marketplace.ts — quale negozio Amazon vede un visitatore, e con quale tracking ID.
 *
 * Precedenza, dall'alto: scelta manuale salvata → paese rilevato → lingue del browser →
 * `defaultMarketplace` di data/amazon-config.json. Ogni gradino ha un `source`, che le pagine
 * mostrano al visitatore («detected from your location»): serve a chi naviga con una VPN o un
 * browser che maschera la provenienza, perché è l'unico modo di capire perché vede il negozio
 * sbagliato e dove correggerlo.
 *
 * Il paese si chiede a `cloudflare.com/cdn-cgi/trace`, che risponde in testo con una riga `loc=XX`,
 * senza chiave e con CORS aperto. Serve perché il sito è statico su GitHub Pages: nessun header
 * geografico lato server, quindi la domanda la fa il browser. La risposta sta nella sessione del
 * browser, non in localStorage: chi viaggia dev'essere rilevato di nuovo al giro dopo.
 *
 * Solo la scelta **manuale** si ricorda (localStorage). Il mercato rilevato non si scrive mai, o
 * finirebbe per sovrascrivere in silenzio una scelta dell'utente.
 *
 * La lingua del browser resta come ripiego: nel 2026 è ancora l'unico segnale disponibile quando
 * la richiesta geografica non arriva (ad blocker, rete lenta, offline).
 */
export const MARKET_STORAGE_KEY = 'bxcf-marketplace';
export const GEO_SESSION_KEY = 'bxcf-geo';
export const MARKET_EVENT = 'bxcf:market';

const GEO_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_TIMEOUT_MS = 1500;

/** Da dove viene il mercato in uso. L'ordine è quello di precedenza. */
export type MarketSource = 'user' | 'geo' | 'lang' | 'default';

const RULES: [RegExp, string][] = [
  [/^it\b/i, 'it'],
  [/^de\b/i, 'de'], [/^gsw\b/i, 'de'],
  [/^fr\b/i, 'fr'], [/^nl-BE\b/i, 'fr'],
  [/^es\b/i, 'es'], [/^ca\b/i, 'es'], [/^eu\b/i, 'es'], [/^gl\b/i, 'es'],
  [/^en-(GB|IE)\b/i, 'uk'], [/^(cy|ga)\b/i, 'uk'],
  [/^ja\b/i, 'jp'],
];

/**
 * Paese ISO 3166-1 alpha-2 → mercato. Ogni paese va a quello che gli spedisce davvero, non a
 * quello che parla la sua lingua: Austria e Svizzera comprano su amazon.de, Belgio e Lussemburgo
 * su amazon.fr, Portogallo su amazon.es. I paesi che non compaiono cadono sulla regola successiva
 * (lingua del browser), non su un mercato scelto a caso.
 */
const COUNTRY_RULES: Record<string, string> = {
  IT: 'it', SM: 'it', VA: 'it',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
  ES: 'es', PT: 'es', AD: 'es',
  GB: 'uk', IE: 'uk', MT: 'uk',
  JP: 'jp',
  US: 'com', CA: 'com', MX: 'com',
};

/**
 * Mercato dedotto dalle lingue del browser (prima regola che matcha, in ordine di preferenza).
 * Nessuna corrispondenza → `fallback`; se nemmeno quello è disponibile, il primo dei disponibili —
 * mai una stringa che non sia un mercato configurato, che darebbe un link senza tag.
 */
export function marketFromLanguages(
  langs: readonly string[] | undefined,
  available: string[],
  fallback: string,
): string {
  for (const l of langs ?? []) {
    if (typeof l !== 'string') continue;   // in Node `navigator.languages` non esiste e resta [undefined]
    for (const [re, m] of RULES) if (re.test(l) && available.includes(m)) return m;
  }
  return available.includes(fallback) ? fallback : available[0];
}

/** Mercato per un paese ISO, o `null` se quel paese non ha una regola (o il mercato non c'è). */
export function marketFromCountry(country: string | null | undefined, available: string[]): string | null {
  if (!country) return null;
  const m = COUNTRY_RULES[country.trim().toUpperCase()];
  return m && available.includes(m) ? m : null;
}

export function readStoredMarket(available: string[]): string | null {
  try {
    const v = localStorage.getItem(MARKET_STORAGE_KEY);
    return v && available.includes(v) ? v : null;
  } catch { return null; }
}

export function storeMarket(market: string): void {
  try { localStorage.setItem(MARKET_STORAGE_KEY, market); } catch { /* storage non disponibile */ }
}

/**
 * Paese del visitatore, o `null` se non si riesce a saperlo — che non è un errore: senza risposta
 * si scende alla lingua del browser. Il timeout è corto apposta, perché questa richiesta ritarda
 * la scelta del negozio e nessun visitatore deve aspettarla.
 */
export async function detectCountry(): Promise<string | null> {
  try {
    const cached = sessionStorage.getItem(GEO_SESSION_KEY);
    if (cached) return cached || null;
  } catch { /* sessionStorage non disponibile: si interroga comunque */ }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
    const res = await fetch(GEO_URL, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const loc = /^loc=([A-Z]{2})$/m.exec(await res.text())?.[1] ?? null;
    try { sessionStorage.setItem(GEO_SESSION_KEY, loc ?? ''); } catch { /* idem */ }
    return loc;
  } catch { return null; }
}

/** Preferenza salvata, altrimenti lingue del browser. Sincrona: è il primo valore, prima del geo. */
export function initialMarket(available: string[], fallback: string): string {
  const stored = readStoredMarket(available);
  if (stored) return stored;
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return marketFromLanguages(langs, available, fallback);
}

/**
 * Il mercato definitivo, con la sua provenienza. `detect` è iniettabile per i test; in pagina è
 * `detectCountry`.
 */
export async function resolveMarket(
  available: string[],
  fallback: string,
  detect: () => Promise<string | null> = detectCountry,
): Promise<{ market: string; source: MarketSource }> {
  const stored = readStoredMarket(available);
  if (stored) return { market: stored, source: 'user' };

  const geo = marketFromCountry(await detect(), available);
  if (geo) return { market: geo, source: 'geo' };

  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  const byLang = marketFromLanguages(langs, available, fallback);
  return { market: byLang, source: byLang === fallback ? 'default' : 'lang' };
}

/* ------------------------------------------------------------------ *
 * Stato condiviso della pagina.
 *
 * In pagina convivono più consumatori (il selettore nell'header, i blocchi «Where to buy», l'isola
 * della home) e devono mostrare tutti lo stesso negozio. Lo stato vive su `window`, non in una
 * variabile di modulo: Astro può mettere gli script in bundle diversi, e due copie del modulo
 * sarebbero due stati che divergono al primo click.
 * ------------------------------------------------------------------ */

type Stato = { market: string; source: MarketSource };

function leggiStato(): Stato | null {
  return (typeof window === 'undefined' ? null : (window as any).__bxcfMarket) ?? null;
}

/** Scrive lo stato e avvisa tutti i consumatori. */
function pubblica(market: string, source: MarketSource): void {
  (window as any).__bxcfMarket = { market, source };
  window.dispatchEvent(new CustomEvent(MARKET_EVENT, { detail: { market, source } }));
}

/** La scelta manuale del visitatore: si ricorda e batte ogni rilevamento, anche dopo un reload. */
export function chooseMarket(market: string): void {
  storeMarket(market);
  pubblica(market, 'user');
}

/**
 * Chiama `cb` subito col valore migliore disponibile senza attendere la rete, poi di nuovo a ogni
 * cambiamento (rilevamento concluso, scelta manuale). La risoluzione parte una volta sola per
 * pagina, quanti che siano i consumatori.
 */
export function subscribeMarket(
  available: string[],
  fallback: string,
  cb: (market: string, source: MarketSource) => void,
): void {
  const gia = leggiStato();
  if (gia) cb(gia.market, gia.source);
  else cb(initialMarket(available, fallback), readStoredMarket(available) ? 'user' : 'lang');

  window.addEventListener(MARKET_EVENT, (e) => {
    const d = (e as CustomEvent).detail as Stato;
    cb(d.market, d.source);
  });

  const w = window as any;
  if (gia || w.__bxcfMarketPending) return;
  w.__bxcfMarketPending = true;
  resolveMarket(available, fallback).then(({ market, source }) => {
    // Una scelta manuale fatta mentre la richiesta era in volo ha la precedenza.
    if (leggiStato()?.source === 'user') return;
    pubblica(market, source);
  });
}
