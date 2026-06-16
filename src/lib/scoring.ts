/**
 * scoring.ts — Competitive Authority Score (CAS).
 *
 * Calcolo DETERMINISTICO dello score di una combo dalla sua `evidence`.
 * Specifica completa e razionale: docs/scoring-algorithm.md.
 *
 * Funzioni pure, nessun side-effect: testabili in isolamento (scripts/test-scoring.ts).
 * L'IA NON calcola lo score: estrae l'evidenza, questo codice la trasforma in numero.
 */
import type { ComboEvidence, ScoreBreakdown, PlacementEvidence } from './types';

// ---- Costanti tarabili (un punto solo). Ricalibrare sulla distribuzione reale. ----
export const CONST = {
  HALF_LIFE_DAYS: 75,        // turnover meta Beyblade X
  W_PERFORMANCE: 0.55,
  W_PRESENCE: 0.30,
  W_CORROBORATION: 0.15,
  K_PERF: 6,
  K_PRES: 3,
  K_CORR: 2.0,         // le TIPOLOGIE di fonti distinte sono poche: satura prima
  K_CONF: 4,                 // usato solo se useConfidence = true
  LANG_DIVERSITY_BONUS: 0.2, // per lingua oltre la prima (corroboration)
  EVENT_WEIGHT_BASE: 16,     // evento da 16 player = peso 1.0
  EVENT_WEIGHT_MIN: 0.5,
  EVENT_WEIGHT_MAX: 3,
  // peso del piazzamento: 1°..8° + top-cut generico
  PLACEMENT: { 1: 1.0, 2: 0.65, 3: 0.45, 4: 0.30, 5: 0.2, 6: 0.2, 7: 0.2, 8: 0.2 } as Record<number, number>,
  PLACEMENT_TOPCUT: 0.12,    // top-cut oltre l'8° o senza posizione nota
  TIER_WEIGHT: { structured: 1.0, narrative: 0.6, theory: 0.3 } as Record<string, number>,
};

/** Mappa saturante: [0,∞) → [0,1), crescente, con rendimenti decrescenti. sat(K)=0.5. */
export function sat(x: number, k: number): number {
  if (x <= 0) return 0;
  return x / (x + k);
}

/** Giorni tra `date` (yyyy-mm-dd) e `ref`; negativi (date future) trattati come 0. */
export function daysBetween(date: string, ref: Date): number {
  const d = new Date(date + 'T00:00:00Z').getTime();
  const r = ref.getTime();
  return Math.max(0, (r - d) / 86_400_000);
}

/** Decadimento esponenziale con emivita HALF_LIFE_DAYS. */
export function decay(date: string, ref: Date): number {
  return Math.pow(0.5, daysBetween(date, ref) / CONST.HALF_LIFE_DAYS);
}

function placementWeight(p: number): number {
  return CONST.PLACEMENT[p] ?? CONST.PLACEMENT_TOPCUT;
}

function eventWeight(players?: number): number {
  if (!players || players <= 0) return 1;
  const w = Math.sqrt(players / CONST.EVENT_WEIGHT_BASE);
  return Math.min(CONST.EVENT_WEIGHT_MAX, Math.max(CONST.EVENT_WEIGHT_MIN, w));
}

export interface ScoreResult {
  score: number;             // 0-10 (1 decimale)
  breakdown: ScoreBreakdown;
  tags: string[];
}

export interface ScoreOptions {
  ref?: Date;                // data di riferimento per il decadimento (default: now)
  useConfidence?: boolean;   // shrinkage esplicito basso-campione (default: false)
}

/**
 * Calcola lo score CAS da un'evidence.
 * `ref` va passato esplicitamente in test/CI per output deterministico.
 */
export function scoreCombo(ev: ComboEvidence, opts: ScoreOptions = {}): ScoreResult {
  const ref = opts.ref ?? new Date();
  const placements = ev.placements ?? [];
  const usage = ev.usage ?? [];
  const mentions = ev.mentions ?? [];

  // --- Pilastro 1: Tournament Performance ---
  let pRaw = 0;
  for (const pl of placements) {
    pRaw += placementWeight(pl.placement)
      * eventWeight(pl.players)
      * (CONST.TIER_WEIGHT[pl.tier] ?? 0.6)
      * decay(pl.date, ref);
  }
  const performance = sat(pRaw, CONST.K_PERF);

  // --- Pilastro 2: Meta Presence / Usage ---
  // Usa lo snapshot usage più "forte" (max share*ampiezza), decaduto per età.
  let presence = 0;
  for (const u of usage) {
    const s = u.sharePct ?? 0;
    const breadth = Math.log1p(u.uniqueEvents ?? 0);
    const p = sat(s * breadth, CONST.K_PRES) * decay(u.date, ref);
    if (p > presence) presence = p;
  }

  // --- Pilastro 3: Source Corroboration ---
  // Fonti DISTINTE (non menzioni), pesate per tier, + bonus diversità lingua.
  const srcWeight = new Map<string, number>();
  const langs = new Set<string>();
  const addSrc = (id: string, tier: string, lang?: string) => {
    const w = CONST.TIER_WEIGHT[tier] ?? 0.6;
    if ((srcWeight.get(id) ?? 0) < w) srcWeight.set(id, w);
    if (lang) langs.add(lang);
  };
  for (const pl of placements) addSrc(pl.source, pl.tier, pl.lang);
  for (const u of usage) addSrc(u.source, 'structured', u.lang);
  for (const m of mentions) addSrc(m.source, 'narrative', m.lang);
  let cRaw = 0;
  for (const w of srcWeight.values()) cRaw += w;
  cRaw += Math.max(0, langs.size - 1) * CONST.LANG_DIVERSITY_BONUS;
  const corroboration = sat(cRaw, CONST.K_CORR);

  // --- Combinazione ---
  let base = CONST.W_PERFORMANCE * performance
    + CONST.W_PRESENCE * presence
    + CONST.W_CORROBORATION * corroboration;

  if (opts.useConfidence) {
    const distinctEvents = new Set(placements.map((p) => p.eventId)).size;
    const nFromUsage = Math.max(0, ...usage.map((u) => u.uniqueEvents ?? 0));
    const n = Math.max(distinctEvents, nFromUsage);
    const confidence = sat(n, CONST.K_CONF);
    base *= 0.5 + 0.5 * confidence;
  }

  const score = Math.round(base * 1000) / 100; // 0-10, 1 decimale (via *10 e arrotondamento)

  // --- Meta osservabile per i badge ---
  const distinctEventIds = new Set(placements.map((p) => p.eventId));
  const wins = placements.filter((p) => p.placement === 1).length;
  const metaShare = Math.max(0, ...usage.map((u) => u.sharePct ?? 0));
  const breakdown: ScoreBreakdown = {
    performance: round3(performance),
    presence: round3(presence),
    corroboration: round3(corroboration),
    tournamentEvents: distinctEventIds.size,
    wins,
    topCutAppearances: placements.length,
    metaSharePct: metaShare > 0 ? metaShare : undefined,
  };

  return { score, breakdown, tags: deriveTags(score, placements, usage) };
}

function deriveTags(score: number, placements: PlacementEvidence[], usage: ComboEvidence['usage']): string[] {
  // Soglie calibrate sulla scala assoluta (il combo dominante tocca ~8.9, non 10).
  const tags: string[] = [];
  if (score >= 8.5) tags.push('meta');
  if (score >= 7.0) tags.push('top-tier');
  const hasStructured = placements.some((p) => p.tier === 'structured')
    || (usage ?? []).some((u) => CONST.TIER_WEIGHT['structured'] && u.source.includes('metabeys'));
  if (hasStructured && placements.length > 0) tags.push('tournament-proven');
  if (placements.length === 0 && (usage ?? []).length === 0) tags.push('theory-only');
  return tags;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
