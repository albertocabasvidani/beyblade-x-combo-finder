/**
 * marketplace.ts — scelta del marketplace Amazon per i link "Buy".
 *
 * Dalle lingue del browser: it → amazon.it, de/at/ch → .de, fr/be → .fr, es → .es, en-GB/en-IE → .co.uk,
 * ja → .co.jp. Tutto il resto (USA compresi) → amazon.com SENZA tag: non esiste un account Associates
 * US, e mandare gli americani su .co.uk sarebbe pessima esperienza. L'utente può forzare il mercato
 * con un select; la scelta resta in localStorage (preferenza dell'utente, non tracciamento).
 */
export const MARKET_STORAGE_KEY = 'bxcf-marketplace';

const RULES: [RegExp, string][] = [
  [/^it\b/i, 'it'],
  [/^de\b/i, 'de'], [/^gsw\b/i, 'de'],
  [/^fr\b/i, 'fr'], [/^nl-BE\b/i, 'fr'],
  [/^es\b/i, 'es'], [/^ca\b/i, 'es'], [/^eu\b/i, 'es'], [/^gl\b/i, 'es'],
  [/^en-(GB|IE)\b/i, 'uk'], [/^(cy|ga)\b/i, 'uk'],
  [/^ja\b/i, 'jp'],
];

/** Mercato dedotto dalle lingue del browser (prima regola che matcha, in ordine di preferenza). */
export function marketFromLanguages(langs: readonly string[] | undefined, available: string[]): string {
  for (const l of langs ?? []) {
    for (const [re, m] of RULES) if (re.test(l) && available.includes(m)) return m;
  }
  return 'com';
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

/** Preferenza salvata, altrimenti lingue del browser. Solo lato client (usa localStorage/navigator). */
export function initialMarket(available: string[]): string {
  const stored = readStoredMarket(available);
  if (stored) return stored;
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return marketFromLanguages(langs, available);
}
