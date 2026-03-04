import type { Combo, SelectedParts, Locale } from '../../lib/types';
import { getMatchedParts } from '../../lib/search-engine';
import { ScoreBadge } from './score-badge';

interface Props {
  combo: Combo;
  displayName: string;
  selected: SelectedParts;
  locale: Locale;
  rank: number;
}

const typeLabels: Record<string, Record<string, string>> = {
  en: { attack: 'Attack', defense: 'Defense', stamina: 'Stamina', balance: 'Balance' },
  it: { attack: 'Attacco', defense: 'Difesa', stamina: 'Resistenza', balance: 'Equilibrio' },
};

const typeColors: Record<string, string> = {
  attack: 'text-red-400',
  defense: 'text-blue-400',
  stamina: 'text-green-400',
  balance: 'text-purple-400',
};

export function ComboCard({ combo, displayName, selected, locale, rank }: Props) {
  const matched = getMatchedParts(combo, selected);
  const hasSelection =
    selected.blades.length > 0 ||
    selected.lockChips.length > 0 ||
    selected.mainBlades.length > 0 ||
    selected.assistBlades.length > 0 ||
    selected.ratchets.length > 0 ||
    selected.bits.length > 0;

  const parts = combo.line === 'bx'
    ? [
        { key: 'blade', label: 'Blade', id: combo.blade },
        { key: 'ratchet', label: 'Ratchet', id: combo.ratchet },
        { key: 'bit', label: 'Bit', id: combo.bit },
      ]
    : [
        { key: 'lockChip', label: 'Lock Chip', id: combo.lockChip },
        { key: 'mainBlade', label: 'Main Blade', id: combo.mainBlade },
        { key: 'assistBlade', label: 'Assist Blade', id: combo.assistBlade },
        { key: 'ratchet', label: 'Ratchet', id: combo.ratchet },
        { key: 'bit', label: 'Bit', id: combo.bit },
      ];

  return (
    <div class="rounded-xl border border-gray-800 bg-gray-900 p-4 transition-colors hover:border-gray-700">
      <div class="mb-2 flex items-start justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-gray-500">#{rank}</span>
          <h3 class="font-bold text-white">{displayName}</h3>
        </div>
        <ScoreBadge score={combo.score} />
      </div>

      <div class="mb-3 flex items-center gap-3 text-xs">
        <span class={typeColors[combo.type] ?? 'text-gray-400'}>
          {typeLabels[locale]?.[combo.type] ?? combo.type}
        </span>
        <span class="text-gray-500">
          {combo.sources.length} {locale === 'it' ? 'fonti' : 'sources'}
        </span>
      </div>

      {hasSelection && (
        <div class="mb-3 flex flex-wrap gap-2">
          {parts.map((part) => {
            const status = matched[part.key]; // 'owned' | 'missing' | 'unset'
            if (status === 'unset') return null;
            return (
              <span
                key={part.key}
                class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                  status === 'owned'
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-orange-500/10 text-orange-400'
                }`}
              >
                {status === 'owned' ? '\u2713' : '!'} {part.label}
              </span>
            );
          })}
        </div>
      )}

      {combo.notes && (
        <p class="text-xs text-gray-500">{combo.notes}</p>
      )}
    </div>
  );
}
