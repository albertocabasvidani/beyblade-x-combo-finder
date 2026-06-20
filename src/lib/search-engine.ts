import type { Combo, SelectedParts, ComboLine, Stadium } from './types';

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
  // Se true, tiene solo le combo le cui parti note non contraddicono le selezioni
  // (combo costruibili/parziali con le parti possedute). Default: mostra tutte.
  onlyBuildable?: boolean;
  // Filtro per linea (BX/UX/CX): vuoto/assente = tutte. NON separa il ranking, lo restringe soltanto.
  lineFilter?: ComboLine[];
  // Filtro per stadio (xtreme/infinity): vuoto/assente = tutti. Tiene le combo con ≥1 placement
  // del piatto scelto (lo stadio è noto solo per i placement WBO).
  stadiumFilter?: Stadium[];
}

// Ranking unico BX + UX + CX, ordinato per score desc. La linea è solo un filtro/etichetta: la
// domanda dell'utente è "la miglior combo per la lama X", non "la miglior combo della linea Y".
export function filterCombos(
  combos: Combo[],
  selected: SelectedParts,
  { onlyBuildable = false, lineFilter, stadiumFilter }: FilterOptions = {},
): Combo[] {
  let base = combos;
  if (lineFilter && lineFilter.length) base = base.filter((c) => lineFilter.includes(c.line));
  if (stadiumFilter && stadiumFilter.length) {
    base = base.filter((c) => (c.scoreBreakdown?.stadiums ?? []).some((s) => stadiumFilter.includes(s)));
  }
  if (onlyBuildable && hasAnySelection(selected)) base = base.filter((c) => isBuildable(c, selected));
  return [...base].sort((a, b) => b.score - a.score);
}

// Migliori combo che usano una blade specifica (BX/UX), ordinate per score. Serve il flusso
// "la miglior combo per la lama X": selezionata una sola blade, il ranking si concentra su di essa.
export function topCombosForBlade(combos: Combo[], bladeId: string): Combo[] {
  return combos.filter((c) => c.blade === bladeId).sort((a, b) => b.score - a.score);
}

// Una combo passa se, per ogni categoria in cui ho selezionato qualcosa, la sua
// parte (quando presente) è tra quelle che possiedo. I campi assenti (blade per le
// CX, parti CX per le BX) sono null e vengono saltati: così la regola vale per
// entrambe le linee senza ramificare.
function isBuildable(combo: Combo, selected: SelectedParts): boolean {
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
export function getMatchedParts(combo: Combo, selected: SelectedParts): Record<string, string> {
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
