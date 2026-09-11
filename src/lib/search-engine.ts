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
  // Finestra temporale del ranking (1/3/6/12 mesi): fuori chi non ha risultati nella finestra,
  // ordine per lo score di quella finestra (calcolato da score:combos, non qui).
  period: WindowKey;
  // Se true, tiene solo le combo le cui parti note non contraddicono le selezioni
  // (combo costruibili/parziali con le parti possedute). Default: mostra tutte.
  onlyBuildable?: boolean;
  // Filtro per linea (BX/UX/CX): vuoto/assente = tutte. NON separa il ranking, lo restringe soltanto.
  lineFilter?: ComboLine[];
  // Filtro per stadio (xtreme/infinity): vuoto/assente = tutti. Tiene le combo con ≥1 placement
  // del piatto scelto nella finestra (lo stadio è noto solo per i placement WBO).
  stadiumFilter?: Stadium[];
}

// Ranking unico BX + UX + CX, ordinato per score desc della finestra. La linea è solo un filtro/
// etichetta: la domanda dell'utente è "la miglior combo per la lama X", non "della linea Y".
export function filterCombos(
  combos: SlimCombo[],
  selected: SelectedParts,
  { period, onlyBuildable = false, lineFilter, stadiumFilter }: FilterOptions,
): SlimCombo[] {
  let base = combos.filter((c) => c.windows[period] !== undefined);
  if (lineFilter && lineFilter.length) base = base.filter((c) => lineFilter.includes(c.line));
  if (stadiumFilter && stadiumFilter.length) {
    base = base.filter((c) => (c.windows[period]!.stadiums ?? []).some((s) => stadiumFilter.includes(s)));
  }
  if (onlyBuildable && hasAnySelection(selected)) base = base.filter((c) => isBuildable(c, selected));
  return [...base].sort((a, b) => b.windows[period]!.score - a.windows[period]!.score);
}

// Una combo passa se, per ogni categoria in cui ho selezionato qualcosa, la sua
// parte (quando presente) è tra quelle che possiedo. I campi assenti (blade per le
// CX, parti CX per le BX) sono null e vengono saltati: così la regola vale per
// entrambe le linee senza ramificare.
function isBuildable(combo: ComboParts, selected: SelectedParts): boolean {
  if (selected.blades.length > 0 && combo.blade && !selected.blades.includes(combo.blade)) return false;
  if (selected.lockChips.length > 0 && combo.lockChip && !selected.lockChips.includes(combo.lockChip)) return false;
  if (selected.mainBlades.length > 0 && combo.mainBlade && !selected.mainBlades.includes(combo.mainBlade)) return false;
  if (selected.assistBlades.length > 0 && combo.assistBlade && !selected.assistBlades.includes(combo.assistBlade)) return false;
  if (selected.overBlades.length > 0 && combo.overBlade && !selected.overBlades.includes(combo.overBlade)) return false;
  if (selected.ratchets.length > 0 && combo.ratchet && !selected.ratchets.includes(combo.ratchet)) return false;
  if (selected.bits.length > 0 && !selected.bits.includes(combo.bit)) return false;
  return true;
}

// Returns 'owned' | 'missing' | 'unset' for each part
export function getMatchedParts(combo: ComboParts, selected: SelectedParts): Record<string, string> {
  if (combo.line === 'bx') {
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
