import type { Combo, SelectedParts } from './types';

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
}

// Ranking unico BX + CX, ordinato per score desc.
export function filterCombos(
  combos: Combo[],
  selected: SelectedParts,
  { onlyBuildable = false }: FilterOptions = {},
): Combo[] {
  const base = onlyBuildable && hasAnySelection(selected)
    ? combos.filter((combo) => isBuildable(combo, selected))
    : combos;

  return [...base].sort((a, b) => b.score - a.score);
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
  if (selected.ratchets.length > 0 && !selected.ratchets.includes(combo.ratchet)) return false;
  if (selected.bits.length > 0 && !selected.bits.includes(combo.bit)) return false;
  return true;
}

// Returns 'owned' | 'missing' | 'unset' for each part
export function getMatchedParts(combo: Combo, selected: SelectedParts): Record<string, string> {
  if (combo.line === 'bx') {
    return {
      blade: selected.blades.length === 0 ? 'unset' : (combo.blade !== null && selected.blades.includes(combo.blade)) ? 'owned' : 'missing',
      ratchet: selected.ratchets.length === 0 ? 'unset' : selected.ratchets.includes(combo.ratchet) ? 'owned' : 'missing',
      bit: selected.bits.length === 0 ? 'unset' : selected.bits.includes(combo.bit) ? 'owned' : 'missing',
    };
  }
  return {
    lockChip: selected.lockChips.length === 0 ? 'unset' : (combo.lockChip !== null && selected.lockChips.includes(combo.lockChip)) ? 'owned' : 'missing',
    mainBlade: selected.mainBlades.length === 0 ? 'unset' : (combo.mainBlade !== null && selected.mainBlades.includes(combo.mainBlade)) ? 'owned' : 'missing',
    assistBlade: selected.assistBlades.length === 0 ? 'unset' : (combo.assistBlade !== null && selected.assistBlades.includes(combo.assistBlade)) ? 'owned' : 'missing',
    overBlade: (selected.overBlades.length === 0 || combo.overBlade == null) ? 'unset' : selected.overBlades.includes(combo.overBlade) ? 'owned' : 'missing',
    ratchet: selected.ratchets.length === 0 ? 'unset' : selected.ratchets.includes(combo.ratchet) ? 'owned' : 'missing',
    bit: selected.bits.length === 0 ? 'unset' : selected.bits.includes(combo.bit) ? 'owned' : 'missing',
  };
}
