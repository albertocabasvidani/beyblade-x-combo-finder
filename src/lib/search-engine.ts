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
  // Se true, tiene solo le combo le cui parti note non contraddicono le selezioni
  // (combo costruibili/parziali con le parti possedute). Default: mostra tutte.
  onlyBuildable?: boolean;
  // Filtro per linea (BX/UX/CX): vuoto/assente = tutte. NON separa il ranking, lo restringe soltanto.
  lineFilter?: ComboLine[];
  // Filtro per stadio (xtreme/infinity): vuoto/assente = tutti. Tiene le combo con ≥1 placement
  // del piatto scelto nella finestra (lo stadio è noto solo per i placement WBO).
  stadiumFilter?: Stadium[];
}

// Ranking unico BX + UX + CX, ordinato per la metrica scelta nella finestra. La linea è solo un
// filtro/etichetta: la domanda dell'utente è "la miglior combo per la lama X", non "della linea Y".
export function filterCombos(
  combos: SlimCombo[],
  selected: SelectedParts,
  { period, sort = 'score', onlyBuildable = false, lineFilter, stadiumFilter }: FilterOptions,
): SlimCombo[] {
  let base = combos.filter((c) => c.windows[period] !== undefined);
  if (lineFilter && lineFilter.length) base = base.filter((c) => lineFilter.includes(c.line));
  if (stadiumFilter && stadiumFilter.length) {
    base = base.filter((c) => (c.windows[period]!.stadiums ?? []).some((s) => stadiumFilter.includes(s)));
  }
  if (onlyBuildable && hasAnySelection(selected)) base = base.filter((c) => isBuildable(c, selected));
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

// Una combo passa se, per ogni categoria in cui ho selezionato qualcosa, la sua
// parte (quando presente) è tra quelle che possiedo. I campi assenti (blade per le
// CX, parti CX per le BX) sono null e vengono saltati: così la regola vale per
// entrambe le linee senza ramificare. Eccezione: la lama. Blade e Main Blade sono la stessa
// scelta («quale lama ho»), quindi se l'utente ha indicato delle lame, una combo è costruibile solo
// se la sua lama (bladeOf) è fra quelle; prima una CX passava sempre con una lama BX selezionata.
function isBuildable(combo: ComboParts, selected: SelectedParts): boolean {
  const ownedBlades = [...selected.blades, ...selected.mainBlades];
  const blade = bladeOf(combo);
  if (ownedBlades.length > 0 && blade && !ownedBlades.includes(blade)) return false;
  if (selected.lockChips.length > 0 && combo.lockChip && !selected.lockChips.includes(combo.lockChip)) return false;
  if (selected.assistBlades.length > 0 && combo.assistBlade && !selected.assistBlades.includes(combo.assistBlade)) return false;
  if (selected.overBlades.length > 0 && combo.overBlade && !selected.overBlades.includes(combo.overBlade)) return false;
  if (selected.ratchets.length > 0 && combo.ratchet && !selected.ratchets.includes(combo.ratchet)) return false;
  if (selected.bits.length > 0 && !selected.bits.includes(combo.bit)) return false;
  return true;
}

// Returns 'owned' | 'missing' | 'unset' for each part
export function getMatchedParts(combo: ComboParts, selected: SelectedParts): Record<string, string> {
  // BX e UX hanno la stessa struttura (blade + ratchet + bit); solo le CX sono a cinque o sei parti.
  if (combo.line !== 'cx') {
    return {
      blade: selected.blades.length === 0 ? 'unset' : (combo.blade !== null && selected.blades.includes(combo.blade)) ? 'owned' : 'missing',
      ratchet: (selected.ratchets.length === 0 || combo.ratchet == null) ? 'unset' : selected.ratchets.includes(combo.ratchet) ? 'owned' : 'missing',
      bit: selected.bits.length === 0 ? 'unset' : selected.bits.includes(combo.bit) ? 'owned' : 'missing',
    };
  }
  return {
    lockChip: selected.lockChips.length === 0 ? 'unset' : (combo.lockChip !== null && selected.lockChips.includes(combo.lockChip)) ? 'owned' : 'missing',
    mainBlade: selected.mainBlades.length === 0 ? 'unset' : (combo.mainBlade !== null && selected.mainBlades.includes(combo.mainBlade)) ? 'owned' : 'missing',
    assistBlade: selected.assistBlades.length === 0 ? 'unset' : (combo.assistBlade !== null && selected.assistBlades.includes(combo.assistBlade)) ? 'owned' : 'missing',
    overBlade: (selected.overBlades.length === 0 || combo.overBlade == null) ? 'unset' : selected.overBlades.includes(combo.overBlade) ? 'owned' : 'missing',
    ratchet: (selected.ratchets.length === 0 || combo.ratchet == null) ? 'unset' : selected.ratchets.includes(combo.ratchet) ? 'owned' : 'missing',
    bit: selected.bits.length === 0 ? 'unset' : selected.bits.includes(combo.bit) ? 'owned' : 'missing',
  };
}
