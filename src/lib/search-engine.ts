import type { SelectedParts, ComboLine, Stadium, WindowKey } from './types';
import type { SlimCombo } from './slim-combos';

/** Le sole parti di una combo: soddisfatto sia da `Combo` sia da `SlimCombo`. */
export interface ComboParts {
  line: ComboLine;
  blade: string | null;
  ratchet: string | null;
  bit: string;
  lockChip: string | null;
  mainBlade: string | null;
  assistBlade: string | null;
  overBlade?: string | null;
}

/** Metrica del ranking: score CAS della finestra (default), top cut, vittorie. */
export type SortKey = 'score' | 'topCut' | 'wins';
export const SORT_KEYS: SortKey[] = ['score', 'topCut', 'wins'];

/**
 * La «lama» di una combo: la Blade per BX/UX, la Main Blade per CX. Stessa regola dei caroselli
 * (src/lib/top-cut.ts): è la parte che dà il nome alla combo.
 */
export function bladeOf(c: ComboParts): string | null {
  return c.line === 'cx' ? c.mainBlade : c.blade;
}

/** Valore della metrica scelta per una combo nella finestra. */
function metric(c: SlimCombo, period: WindowKey, sort: SortKey): number {
  const w = c.windows[period]!;
  return sort === 'topCut' ? w.topCutAppearances : sort === 'wins' ? w.wins : w.score;
}

/**
 * Ordine del ranking. Score: score, poi nome. Top cut: top cut, poi vittorie, poi nome; Vittorie:
 * vittorie, poi top cut, poi nome. Lo spareggio di Top cut è lo stesso dei caroselli Instagram
 * (comboStats in src/lib/top-cut.ts), così a pari top cut l'ordine della home e del post coincide.
 */
export function compareCombos(period: WindowKey, sort: SortKey) {
  const other: SortKey = sort === 'topCut' ? 'wins' : sort === 'wins' ? 'topCut' : 'score';
  return (a: SlimCombo, b: SlimCombo) =>
    metric(b, period, sort) - metric(a, period, sort)
    || metric(b, period, other) - metric(a, period, other)
    || a.displayName.localeCompare(b.displayName);
}

export function hasAnySelection(selected: SelectedParts): boolean {
  return (
    selected.blades.length > 0 ||
    selected.lockChips.length > 0 ||
    selected.mainBlades.length > 0 ||
    selected.assistBlades.length > 0 ||
    selected.overBlades.length > 0 ||
    selected.ratchets.length > 0 ||
    selected.bits.length > 0
  );
}

interface FilterOptions {
  // Finestra temporale del ranking (30/90/180/365 giorni): fuori chi non ha risultati nella finestra.
  // I valori per finestra (score, top cut, vittorie) li calcola score:combos, non questo modulo.
  period: WindowKey;
  // Metrica dell'ordinamento (default score).
  sort?: SortKey;
  // Filtro per linea (BX/UX/CX): vuoto/assente = tutte. NON separa il ranking, lo restringe soltanto.
  lineFilter?: ComboLine[];
  // Filtro per stadio (xtreme/infinity): vuoto/assente = tutti. Tiene le combo con ≥1 placement
  // del piatto scelto nella finestra (lo stadio è noto solo per i placement WBO).
  stadiumFilter?: Stadium[];
}

// Ranking unico BX + UX + CX, ordinato per la metrica scelta nella finestra. La linea è solo un
// filtro/etichetta: la domanda dell'utente è "la miglior combo per la lama X", non "della linea Y".
// Le parti inserite nella ricerca filtrano sempre (matchesSearch): non sono un inventario.
export function filterCombos(
  combos: SlimCombo[],
  selected: SelectedParts,
  { period, sort = 'score', lineFilter, stadiumFilter }: FilterOptions,
): SlimCombo[] {
  let base = combos.filter((c) => c.windows[period] !== undefined);
  if (lineFilter && lineFilter.length) base = base.filter((c) => lineFilter.includes(c.line));
  if (stadiumFilter && stadiumFilter.length) {
    base = base.filter((c) => (c.windows[period]!.stadiums ?? []).some((s) => stadiumFilter.includes(s)));
  }
  if (hasAnySelection(selected)) base = base.filter((c) => matchesSearch(c, selected));
  return [...base].sort(compareCombos(period, sort));
}

/** Una riga della vista «Blades»: una lama con la somma delle sue combo nella finestra. */
export interface BladeRow {
  blade: string;
  line: 'bx' | 'cx';
  topCut: number;
  wins: number;
  /** Quota sui top cut delle combo mostrate (coi filtri attivi), 0..1. */
  share: number;
  builds: number;
  /** La combo migliore della lama secondo la metrica scelta. */
  best: SlimCombo;
}

/**
 * Raggruppa per lama le combo già filtrate e ordinate. Le lame senza top cut nella finestra (combo
 * con sola usage) restano fuori: una riga «0 top cuts» non dice niente. Ordine: con Score lo score
 * della build migliore, altrimenti la somma di top cut o vittorie; a parità l'altra delle due, poi
 * l'id. Il carosello top-lame ordina per top cut e poi per id: a parità di vittorie l'ordine coincide.
 */
export function aggregateBlades(sorted: SlimCombo[], period: WindowKey, sort: SortKey): BladeRow[] {
  const rows = new Map<string, BladeRow>();
  let total = 0;
  for (const c of sorted) {
    const b = bladeOf(c);
    const w = c.windows[period];
    if (!b || !w) continue;
    total += w.topCutAppearances;
    const r = rows.get(b);
    if (r) { r.topCut += w.topCutAppearances; r.wins += w.wins; r.builds++; }
    else rows.set(b, { blade: b, line: c.line === 'cx' ? 'cx' : 'bx', topCut: w.topCutAppearances, wins: w.wins, share: 0, builds: 1, best: c });
  }
  const out = [...rows.values()].filter((r) => r.topCut > 0);
  for (const r of out) r.share = total ? r.topCut / total : 0;
  const bestScore = (r: BladeRow) => r.best.windows[period]!.score;
  const key = (r: BladeRow, k: SortKey) => (k === 'topCut' ? r.topCut : k === 'wins' ? r.wins : bestScore(r));
  const other: SortKey = sort === 'topCut' ? 'wins' : sort === 'wins' ? 'topCut' : 'score';
  return out.sort((a, b) => key(b, sort) - key(a, sort) || key(b, other) - key(a, other) || a.blade.localeCompare(b.blade));
}

/**
 * Una combo risponde alla ricerca se, per ogni categoria in cui è stato inserito qualcosa, la sua
 * parte è fra quelle inserite: «e» fra categorie diverse, «o» dentro la stessa (Wizard Rod + Shark
 * Scale = le combo dell'una o dell'altra). Blade e Main Blade sono la stessa scelta, la lama (bladeOf).
 * Una parte che la combo non ha (ratchet integrato nella lama, parti CX di una BX) non risponde: chi
 * cerca 1-60 vuole le combo col 1-60, non quelle senza ratchet.
 * Fino al 02/10/2026 c'erano anche «Compare with my parts» e «Buildable», che trattavano le parti
 * inserite come un inventario: tolti, perché la stessa selezione faceva due lavori diversi.
 */
export function matchesSearch(combo: ComboParts, selected: SelectedParts): boolean {
  const blades = [...selected.blades, ...selected.mainBlades];
  const has = (want: string[], part: string | null | undefined) => want.length === 0 || (!!part && want.includes(part));
  return has(blades, bladeOf(combo))
    && has(selected.lockChips, combo.lockChip)
    && has(selected.assistBlades, combo.assistBlade)
    && has(selected.overBlades, combo.overBlade)
    && has(selected.ratchets, combo.ratchet)
    && has(selected.bits, combo.bit);
}

