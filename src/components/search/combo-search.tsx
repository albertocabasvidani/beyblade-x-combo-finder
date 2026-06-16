import { useState } from 'preact/hooks';
import type { PartsRegistry, CombosDatabase, Combo, SelectedParts, Locale, ComboLine, Stadium } from '../../lib/types';
import { filterCombos } from '../../lib/search-engine';
import { PartSearch, type PartRef, type PartCategory } from './part-search';
import { ComboCard } from './combo-card';

interface Props {
  parts: PartsRegistry;
  combos: CombosDatabase;
  locale: Locale;
  translations: Record<string, string>;
}

const emptySelection: SelectedParts = {
  blades: [],
  lockChips: [],
  mainBlades: [],
  assistBlades: [],
  overBlades: [],
  ratchets: [],
  bits: [],
};

// chiave categoria della combo -> chiave plurale in SelectedParts
const COMBO_PART_CATEGORY: Record<string, PartCategory> = {
  blade: 'blades',
  ratchet: 'ratchets',
  bit: 'bits',
  lockChip: 'lockChips',
  mainBlade: 'mainBlades',
  assistBlade: 'assistBlades',
  overBlade: 'overBlades',
};

// Toggle solo visivo: l'elemento interattivo è il contenitore (evita button annidati).
function Switch({ checked, onVar }: { checked: boolean; onVar: string }) {
  return (
    <span
      class="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
      style={{ background: checked ? `var(${onVar})` : 'var(--c-track)' }}
    >
      <span
        class="absolute top-[2px] h-[18px] w-[18px] rounded-full transition-all"
        style={{ left: checked ? '18px' : '2px', background: 'var(--c-knob)' }}
      />
    </span>
  );
}

export default function ComboSearch({ parts, combos, locale, translations }: Props) {
  const [selected, setSelected] = useState<SelectedParts>({ ...emptySelection });
  const [compare, setCompare] = useState(false);
  const [onlyBuildable, setOnlyBuildable] = useState(false);
  const [tournamentOnly, setTournamentOnly] = useState(false);
  const [metaOnly, setMetaOnly] = useState(false);
  const [lineFilter, setLineFilter] = useState<ComboLine[]>([]);
  const [stadiumFilter, setStadiumFilter] = useState<Stadium[]>([]);

  const toggleIn = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const t = (key: string) => translations[key] ?? key;

  const add = (category: PartCategory, id: string) =>
    setSelected((prev) => (prev[category].includes(id) ? prev : { ...prev, [category]: [...prev[category], id] }));

  const remove = (category: PartCategory, id: string) =>
    setSelected((prev) => ({ ...prev, [category]: prev[category].filter((x) => x !== id) }));

  // Ricerca blade-centrica: una sola blade selezionata (e nient'altro) = "la miglior combo per la
  // lama X". Restringe il ranking a quella blade e cambia l'intestazione.
  const onlyBlade =
    selected.blades.length === 1 &&
    selected.lockChips.length === 0 && selected.mainBlades.length === 0 &&
    selected.assistBlades.length === 0 && selected.overBlades.length === 0 &&
    selected.ratchets.length === 0 && selected.bits.length === 0;

  let results = filterCombos(combos.combos, selected, { onlyBuildable, lineFilter, stadiumFilter });
  if (onlyBlade) results = results.filter((c) => c.blade === selected.blades[0]);
  if (tournamentOnly) results = results.filter((c) => (c.tags ?? []).includes('tournament-proven'));
  if (metaOnly) results = results.filter((c) => (c.tags ?? []).some((tag) => tag === 'meta' || tag === 'top-tier'));

  const resolveName = (category: PartCategory, id: string): string => {
    const arr = parts[category] as Array<{ id: string; name: string }>;
    return arr.find((p) => p.id === id)?.name ?? id;
  };

  const rankingTitle = onlyBlade
    ? `${t('search.bestForBlade')} ${resolveName('blades', selected.blades[0])}`
    : t('search.ranking');

  // nome di una parte combo (chiavi singolari: blade/ratchet/...)
  const partName = (category: string, id: string | null): string => {
    if (!id) return '';
    const cat = COMBO_PART_CATEGORY[category];
    return cat ? resolveName(cat, id) : id;
  };

  const comboDisplayName = (combo: Combo): string => {
    const keys = combo.line === 'bx'
      ? [['blade', combo.blade], ['ratchet', combo.ratchet], ['bit', combo.bit]]
      : [
          ['lockChip', combo.lockChip],
          ['overBlade', combo.overBlade ?? null],
          ['mainBlade', combo.mainBlade],
          ['assistBlade', combo.assistBlade],
          ['ratchet', combo.ratchet],
          ['bit', combo.bit],
        ];
    return keys.map(([k, id]) => partName(k as string, id as string | null)).filter(Boolean).join(' ');
  };

  // Suggerimenti: parti più frequenti nelle top combo, non ancora possedute.
  const suggestions: PartRef[] = (() => {
    const top = [...combos.combos].sort((a, b) => b.score - a.score).slice(0, 20);
    const counts = new Map<string, { category: PartCategory; id: string; n: number }>();
    const bump = (category: PartCategory, id: string | null | undefined) => {
      if (!id || selected[category].includes(id)) return;
      const k = `${category}:${id}`;
      const e = counts.get(k);
      if (e) e.n++;
      else counts.set(k, { category, id, n: 1 });
    };
    for (const c of top) {
      bump('blades', c.blade);
      bump('ratchets', c.ratchet);
      bump('bits', c.bit);
      bump('lockChips', c.lockChip);
      bump('mainBlades', c.mainBlade);
      bump('assistBlades', c.assistBlade);
      bump('overBlades', c.overBlade ?? null);
    }
    return [...counts.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 6)
      .map((e) => ({ category: e.category, id: e.id, name: resolveName(e.category, e.id) }));
  })();

  const Pill = ({ active, onToggle, label, accentVar }: { active: boolean; onToggle: () => void; label: string; accentVar: string }) => (
    <button
      type="button"
      onClick={onToggle}
      class={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
        active ? '' : 'border-border bg-surface-2 text-muted hover:text-text'
      }`}
      style={active ? { borderColor: `var(${accentVar})`, background: `color-mix(in srgb, var(${accentVar}) 14%, transparent)`, color: `var(${accentVar})` } : undefined}
    >
      {label}
    </button>
  );

  return (
    <div class="lg:grid lg:grid-cols-[340px_1fr] lg:gap-7">
      {/* ---------- Pannello "Le tue parti" (rail su desktop) ---------- */}
      <section class="mb-6 self-start rounded-[14px] border border-border bg-surface p-4 lg:mb-0">
        <h2 class="font-display text-[18px] uppercase text-text lg:text-[19px]">{t('search.yourParts')}</h2>

        <button
          type="button"
          role="switch"
          aria-checked={compare}
          onClick={() => setCompare((v) => !v)}
          class="mt-3 flex w-full items-center justify-between gap-3 rounded-[11px] bg-surface-2 px-3 py-2.5 text-left"
        >
          <span class="min-w-0">
            <span class="block text-[13px] font-semibold text-text">{t('search.compareLabel')}</span>
            <span class="block text-[11px] text-muted-2">{t('search.compareSub')}</span>
          </span>
          <Switch checked={compare} onVar="--c-gold" />
        </button>

        <div class="mt-3">
          <PartSearch parts={parts} selected={selected} suggestions={suggestions} onAdd={add} onRemove={remove} t={t} />
        </div>

        <div class="mt-4">
          <div class="mb-2 hidden font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2 lg:block">{t('search.filters')}</div>
          <div class="flex flex-wrap gap-2">
            <Pill active={tournamentOnly} onToggle={() => setTournamentOnly((v) => !v)} label={t('filter.tournamentProven')} accentVar="--c-scarlet" />
            <Pill active={metaOnly} onToggle={() => setMetaOnly((v) => !v)} label={t('filter.metaOnly')} accentVar="--c-gold" />
            <Pill active={onlyBuildable} onToggle={() => setOnlyBuildable((v) => !v)} label={t('search.onlyBuildable')} accentVar="--c-gold" />
          </div>
          {/* Linea (BX/UX/CX) e stadio: solo filtro/etichetta, non separano il ranking. */}
          <div class="mt-2 flex flex-wrap gap-2">
            {(['bx', 'ux', 'cx'] as ComboLine[]).map((ln) => (
              <Pill key={ln} active={lineFilter.includes(ln)} onToggle={() => setLineFilter((f) => toggleIn(f, ln))} label={ln.toUpperCase()} accentVar="--c-cx-text" />
            ))}
            {(['xtreme', 'infinity'] as Stadium[]).map((st) => (
              <Pill key={st} active={stadiumFilter.includes(st)} onToggle={() => setStadiumFilter((f) => toggleIn(f, st))} label={t(`stadium.${st}`)} accentVar="--c-scarlet" />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Ranking ---------- */}
      <section>
        <div class="mb-4 flex items-center gap-3">
          <h2 class="font-display text-[18px] uppercase text-text lg:text-[24px]">{rankingTitle}</h2>
          <span class="h-0.5 flex-1 rounded-full" style={{ background: 'var(--grad-ranking)' }} aria-hidden="true" />
          <span class="shrink-0 font-mono text-[11px] text-muted-2">
            {results.length} {t('search.combosUnit')}
          </span>
        </div>

        {results.length === 0 ? (
          <div class="rounded-[14px] border border-border bg-surface p-8 text-center">
            <p class="text-sm text-muted-2">{t('search.noResults')}</p>
          </div>
        ) : (
          <div class="flex flex-col gap-3 lg:gap-2.5">
            {results.map((combo, i) => (
              <ComboCard
                key={combo.id}
                combo={combo}
                displayName={comboDisplayName(combo)}
                selected={selected}
                compare={compare}
                locale={locale}
                rank={i + 1}
                partName={partName}
                t={t}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
