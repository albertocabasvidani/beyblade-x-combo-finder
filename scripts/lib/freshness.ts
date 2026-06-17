/**
 * freshness.ts — Cutoff temporale condiviso della pipeline combo (deterministico).
 *
 * Unica fonte di verità per "quanto indietro guardiamo": usato da fetch (stop paginazione storica),
 * parse (scarto dei placement più vecchi del cutoff) e score (filtro dell'evidence unita). Tenere il
 * confine in un solo modulo evita cutoff duplicati e divergenti tra gli stadi della pipeline.
 *
 * Il decadimento dello scoring (emivita 75gg in src/lib/scoring.ts) rende un evento di 12 mesi fa già
 * ~0.034: il cutoff a 12 mesi è coerente col modello e taglia la coda di rumore statistico.
 */

/** Mesi di storia trattenuti. Override via env COMBO_CUTOFF_MONTHS (test/tuning); default 12. */
export const CUTOFF_MONTHS: number = (() => {
  const n = parseInt(process.env.COMBO_CUTOFF_MONTHS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 12;
})();

/**
 * Confine di freschezza come 'YYYY-MM-DD': ref meno CUTOFF_MONTHS mesi (in UTC).
 * Una data >= a questo confine è "fresca". `ref` è iniettabile per test deterministici.
 */
export function cutoffISO(ref: Date = new Date()): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - CUTOFF_MONTHS);
  return d.toISOString().slice(0, 10);
}

/**
 * True se la data ISO 'YYYY-MM-DD' è entro il cutoff (>= confine). Confronto lessicografico, valido
 * per il formato ISO zero-padded. Data assente/vuota → true: non si scarta ciò di cui non si conosce
 * l'età (gli eventi senza data parsabile vanno tenuti, non persi — vedi piano).
 */
export function isFresh(date: string | undefined | null, ref: Date = new Date()): boolean {
  if (!date) return true;
  return date >= cutoffISO(ref);
}

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/**
 * Estrae una data lunga "Saturday, June 13, 2026" / "June 13, 2026" → "2026-06-13".
 * Ritorna null se non matcha. Formato usato dalle pagine evento MetaBeys (lista e dettaglio):
 * condiviso tra fetch-metabeys (stop paginazione) e parse-metabeys (estrazione placement).
 */
export function parseLongDate(raw: string): string | null {
  const m = raw.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
}
