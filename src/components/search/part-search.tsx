import { useState, useRef } from 'preact/hooks';
import type { PartsRegistry, SelectedParts } from '../../lib/types';

export type PartCategory = keyof SelectedParts;

export interface PartRef {
  category: PartCategory;
  id: string;
  name: string;
}

interface Props {
  parts: PartsRegistry;
  selected: SelectedParts;
  suggestions: PartRef[];
  onAdd: (category: PartCategory, id: string) => void;
  onRemove: (category: PartCategory, id: string) => void;
  t: (key: string) => string;
}

// Categorie indicizzate dalla ricerca unica. partsKey == category (i nomi coincidono
// tra PartsRegistry e SelectedParts); labelKey è la chiave i18n del tag categoria.
const CATEGORIES: { category: PartCategory; labelKey: string }[] = [
  { category: 'blades', labelKey: 'search.blades' },
  { category: 'lockChips', labelKey: 'search.lockChips' },
  { category: 'mainBlades', labelKey: 'search.mainBlades' },
  { category: 'assistBlades', labelKey: 'search.assistBlades' },
  { category: 'overBlades', labelKey: 'search.overBlades' },
  { category: 'ratchets', labelKey: 'search.ratchets' },
  { category: 'bits', labelKey: 'search.bits' },
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function PartSearch({ parts, selected, suggestions, onAdd, onRemove, t }: Props) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Indice piatto di tutte le parti, una sola lista per tutte le categorie/linee.
  const index: (PartRef & { catLabel: string })[] = CATEGORIES.flatMap((c) =>
    (parts[c.category] as Array<{ id: string; name: string }>).map((p) => ({
      category: c.category,
      id: p.id,
      name: p.name,
      catLabel: t(c.labelKey),
    })),
  );

  const q = query.trim().toLowerCase();
  const available = index
    .filter((o) => !selected[o.category].includes(o.id) && (q === '' || o.name.toLowerCase().includes(q)))
    .slice(0, 50);

  const owned: PartRef[] = CATEGORIES.flatMap((c) =>
    selected[c.category].map((id) => {
      const found = (parts[c.category] as Array<{ id: string; name: string }>).find((p) => p.id === id);
      return { category: c.category, id, name: found ? found.name : id };
    }),
  );

  return (
    <div>
      {/* Search box unica */}
      <div class="relative">
        <div
          class="flex items-center gap-2 rounded-[11px] border border-border bg-surface-2 px-3 py-2.5 focus-within:border-gold"
          onClick={() => inputRef.current?.focus()}
        >
          <span class="text-muted-2">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t('search.searchPlaceholder')}
            class="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted-2"
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          />
        </div>

        {isOpen && available.length > 0 && (
          <ul class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-[11px] border border-border bg-surface shadow-lg">
            {available.map((opt) => (
              <li key={`${opt.category}:${opt.id}`}>
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-text hover:bg-surface-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onAdd(opt.category, opt.id);
                    setQuery('');
                    setIsOpen(false);
                  }}
                >
                  <span>{opt.name}</span>
                  <span class="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2">{opt.catLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Chip parti possedute */}
      {owned.length > 0 && (
        <div class="mt-3 flex flex-wrap gap-2">
          {owned.map((c) => (
            <span
              key={`${c.category}:${c.id}`}
              class="inline-flex items-center gap-1.5 rounded-[9px] bg-gold px-2.5 py-1 text-xs font-bold text-gold-ink"
            >
              {c.name}
              <button
                type="button"
                aria-label={`remove ${c.name}`}
                onClick={() => onRemove(c.category, c.id)}
                class="grid h-4 w-4 place-items-center rounded-full leading-none transition-opacity hover:opacity-70"
                style={{ background: 'color-mix(in srgb, var(--c-gold-ink) 22%, transparent)' }}
              >
                {'×'}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Chip suggeriti (non ancora posseduti) */}
      {suggestions.length > 0 && (
        <>
          <div class="mt-3 mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
            {t('search.suggested')}
          </div>
          <div class="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={`${s.category}:${s.id}`}
                type="button"
                onClick={() => onAdd(s.category, s.id)}
                class="inline-flex items-center gap-1 rounded-[9px] border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:border-gold hover:text-text"
              >
                + {s.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
