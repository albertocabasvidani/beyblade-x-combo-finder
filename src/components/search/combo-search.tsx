import { useState } from 'preact/hooks';
import type { PartsRegistry, CombosDatabase, ComboLine, Combo, SelectedParts, NameVariant, Locale } from '../../lib/types';
import type { AmazonConfig, ProductLookup } from '../../lib/amazon';
import { filterCombos } from '../../lib/search-engine';
import { PartSelector } from './part-selector';
import { ComboCard } from './combo-card';

interface Props {
  parts: PartsRegistry;
  combos: CombosDatabase;
  locale: Locale;
  translations: Record<string, string>;
  amazonConfig: AmazonConfig;
  productLookup: ProductLookup;
}

const emptySelection: SelectedParts = {
  blades: [],
  lockChips: [],
  mainBlades: [],
  assistBlades: [],
  ratchets: [],
  bits: [],
};

export default function ComboSearch({ parts, combos, locale, translations, amazonConfig, productLookup }: Props) {
  const [line, setLine] = useState<ComboLine>('bx');
  const [selected, setSelected] = useState<SelectedParts>({ ...emptySelection });
  const [nameVariant, setNameVariant] = useState<NameVariant>('eastern');

  const t = (key: string) => translations[key] ?? key;

  const toggle = (category: keyof SelectedParts, id: string) => {
    setSelected((prev) => ({
      ...prev,
      [category]: prev[category].includes(id)
        ? prev[category].filter((x) => x !== id)
        : [...prev[category], id],
    }));
  };

  const remove = (category: keyof SelectedParts, id: string) => {
    setSelected((prev) => ({
      ...prev,
      [category]: prev[category].filter((x) => x !== id),
    }));
  };

  const results = filterCombos(combos.combos, line, selected);

  const switchLine = (newLine: ComboLine) => {
    setLine(newLine);
    setSelected({ ...emptySelection });
  };

  const dn = (part: { name: string; nameWestern?: string }) =>
    nameVariant === 'western' && part.nameWestern ? part.nameWestern : part.name;

  const getPartName = (category: string, id: string | null): string => {
    if (!id) return '';
    const map: Record<string, readonly { id: string; name: string; nameWestern?: string }[]> = {
      blade: parts.blades,
      lockChip: parts.lockChips,
      mainBlade: parts.mainBlades,
      assistBlade: parts.assistBlades,
      ratchet: parts.ratchets,
      bit: parts.bits,
    };
    const arr = map[category];
    if (!arr) return id;
    const found = arr.find((p) => p.id === id);
    if (!found) return id;
    return dn(found);
  };

  const comboDisplayName = (combo: Combo): string => {
    if (combo.line === 'bx') {
      return `${getPartName('blade', combo.blade)} ${getPartName('ratchet', combo.ratchet)} ${getPartName('bit', combo.bit)}`;
    }
    return `${getPartName('lockChip', combo.lockChip)} ${getPartName('mainBlade', combo.mainBlade)} ${getPartName('assistBlade', combo.assistBlade)} ${getPartName('ratchet', combo.ratchet)} ${getPartName('bit', combo.bit)}`;
  };

  return (
    <div>
      {/* Line tabs + Name variant toggle */}
      <div class="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-2">
          <button
            onClick={() => switchLine('bx')}
            class={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              line === 'bx'
                ? 'bg-yellow-500 text-gray-900'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {t('tabs.bx')}
          </button>
          <button
            onClick={() => switchLine('cx')}
            class={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              line === 'cx'
                ? 'bg-yellow-500 text-gray-900'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {t('tabs.cx')}
          </button>
        </div>

        <div class="flex gap-1 rounded-lg border border-gray-700 bg-gray-800 p-0.5">
          <button
            onClick={() => setNameVariant('eastern')}
            class={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              nameVariant === 'eastern'
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {t('names.tt')}
          </button>
          <button
            onClick={() => setNameVariant('western')}
            class={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              nameVariant === 'western'
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {t('names.hasbro')}
          </button>
        </div>
      </div>

      {/* Part selectors */}
      <div class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        {line === 'bx' ? (
          <>
            <PartSelector
              label={t('search.blades')}
              placeholder={t('search.placeholder')}
              options={parts.blades.map((b) => ({ id: b.id, name: dn(b) }))}
              selected={selected.blades}
              onSelect={(id) => toggle('blades', id)}
              onRemove={(id) => remove('blades', id)}
            />
            <PartSelector
              label={t('search.ratchets')}
              placeholder={t('search.placeholder')}
              options={parts.ratchets.map((r) => ({ id: r.id, name: r.name }))}
              selected={selected.ratchets}
              onSelect={(id) => toggle('ratchets', id)}
              onRemove={(id) => remove('ratchets', id)}
            />
            <PartSelector
              label={t('search.bits')}
              placeholder={t('search.placeholder')}
              options={parts.bits.map((b) => ({ id: b.id, name: b.name }))}
              selected={selected.bits}
              onSelect={(id) => toggle('bits', id)}
              onRemove={(id) => remove('bits', id)}
            />
          </>
        ) : (
          <>
            <PartSelector
              label={t('search.lockChips')}
              placeholder={t('search.placeholder')}
              options={parts.lockChips.map((c) => ({ id: c.id, name: dn(c) }))}
              selected={selected.lockChips}
              onSelect={(id) => toggle('lockChips', id)}
              onRemove={(id) => remove('lockChips', id)}
            />
            <PartSelector
              label={t('search.mainBlades')}
              placeholder={t('search.placeholder')}
              options={parts.mainBlades.map((b) => ({ id: b.id, name: dn(b) }))}
              selected={selected.mainBlades}
              onSelect={(id) => toggle('mainBlades', id)}
              onRemove={(id) => remove('mainBlades', id)}
            />
            <PartSelector
              label={t('search.assistBlades')}
              placeholder={t('search.placeholder')}
              options={parts.assistBlades.map((b) => ({ id: b.id, name: b.name }))}
              selected={selected.assistBlades}
              onSelect={(id) => toggle('assistBlades', id)}
              onRemove={(id) => remove('assistBlades', id)}
            />
            <PartSelector
              label={t('search.ratchets')}
              placeholder={t('search.placeholder')}
              options={parts.ratchets.map((r) => ({ id: r.id, name: r.name }))}
              selected={selected.ratchets}
              onSelect={(id) => toggle('ratchets', id)}
              onRemove={(id) => remove('ratchets', id)}
            />
            <PartSelector
              label={t('search.bits')}
              placeholder={t('search.placeholder')}
              options={parts.bits.map((b) => ({ id: b.id, name: b.name }))}
              selected={selected.bits}
              onSelect={(id) => toggle('bits', id)}
              onRemove={(id) => remove('bits', id)}
            />
          </>
        )}
      </div>

      {/* Results */}
      <div>
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-medium text-gray-400">
            {t('search.results')} ({results.length})
          </h2>
        </div>

        {results.length === 0 ? (
          <div class="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
            <p class="text-sm text-gray-500">{t('search.noResults')}</p>
          </div>
        ) : (
          <div class="flex flex-col gap-3">
            {results.map((combo, i) => (
              <ComboCard
                key={combo.id}
                combo={combo}
                displayName={comboDisplayName(combo)}
                selected={selected}
                locale={locale}
                rank={i + 1}
                amazonConfig={amazonConfig}
                productLookup={productLookup}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
