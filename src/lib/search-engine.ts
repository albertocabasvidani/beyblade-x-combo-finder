import type { Combo, ComboLine, SelectedParts } from './types';

export function filterCombos(
  combos: Combo[],
  line: ComboLine,
  selected: SelectedParts,
): Combo[] {
  const lineFiltered = combos.filter((c) => c.line === line);

  const hasAnySelection =
    selected.blades.length > 0 ||
    selected.lockChips.length > 0 ||
    selected.mainBlades.length > 0 ||
    selected.assistBlades.length > 0 ||
    selected.ratchets.length > 0 ||
    selected.bits.length > 0;

  if (!hasAnySelection) {
    return lineFiltered.sort((a, b) => b.score - a.score);
  }

  const filtered = lineFiltered.filter((combo) => {
    if (line === 'bx') {
      if (selected.blades.length > 0 && combo.blade && !selected.blades.includes(combo.blade)) return false;
      if (selected.ratchets.length > 0 && !selected.ratchets.includes(combo.ratchet)) return false;
      if (selected.bits.length > 0 && !selected.bits.includes(combo.bit)) return false;
      return true;
    }

    // CX line
    if (selected.lockChips.length > 0 && combo.lockChip && !selected.lockChips.includes(combo.lockChip)) return false;
    if (selected.mainBlades.length > 0 && combo.mainBlade && !selected.mainBlades.includes(combo.mainBlade)) return false;
    if (selected.assistBlades.length > 0 && combo.assistBlade && !selected.assistBlades.includes(combo.assistBlade)) return false;
    if (selected.ratchets.length > 0 && !selected.ratchets.includes(combo.ratchet)) return false;
    if (selected.bits.length > 0 && !selected.bits.includes(combo.bit)) return false;
    return true;
  });

  return filtered.sort((a, b) => b.score - a.score);
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
    ratchet: selected.ratchets.length === 0 ? 'unset' : selected.ratchets.includes(combo.ratchet) ? 'owned' : 'missing',
    bit: selected.bits.length === 0 ? 'unset' : selected.bits.includes(combo.bit) ? 'owned' : 'missing',
  };
}
