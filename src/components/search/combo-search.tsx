import { useEffect, useRef, useState } from 'preact/hooks';
import type { PartsRegistry, SelectedParts, Locale, ComboLine, Stadium, WindowKey } from '../../lib/types';
import type { SlimCombo, SlimDatabase } from '../../lib/slim-combos';
import { aggregateBlades, bladeOf, filterCombos, SORT_KEYS, type SortKey } from '../../lib/search-engine';
import { track } from '../../lib/analytics';
import type { AmazonConfigFile, AsinIndex, PartLookup } from '../../lib/amazon';
import { subscribeMarket, chooseMarket, type MarketSource } from '../../lib/marketplace';
import { AdUnit } from '../ads/ad-unit';
import { INFEED_AFTER, INFEED_EVERY } from '../../lib/ads-config';
import { PartSearch, type PartRef, type PartCategory } from './part-search';
import { ComboCard } from './combo-card';
import { BladeRow } from './blade-row';

interface Props {
  parts: PartsRegistry;
  /** Prime combo inline (primo paint): il dataset completo arriva da `dataUrl`. */
  initial: SlimDatabase;
  dataUrl: string;
  /** Link affiliati: config marketplace/tag, lookup parte → codice set, ASIN per codice. */
  amazon: { config: AmazonConfigFile; lookup: PartLookup; asins: AsinIndex };
  locale: Locale;
  translations: Record<string, string>;
}

const PERIODS: WindowKey[] = ['30', '90', '180', '365'];
// Finestra delle combo inline (primo paint): l'unica disponibile finché non arriva il dataset completo.
const INLINE_PERIOD: WindowKey = '365';
type View = 'combos' | 'blades';
const VIEWS: View[] = ['combos', 'blades'];
type DatasetState = 'loading' | 'ready' | 'failed';
const PAGE = 60;   // card renderizzate per volta ("Show more"): 4.000 card in DOM rendevano la pagina lenta

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

export default function ComboSearch({ parts, initial, dataUrl, amazon, locale, translations }: Props) {
  const [db, setDb] = useState<SlimDatabase>(initial);
  const [dataset, setDataset] = useState<DatasetState>('loading');
  const [period, setPeriod] = useState<WindowKey>(INLINE_PERIOD);
  const [sort, setSort] = useState<SortKey>('score');
  const [view, setView] = useState<View>('combos');
  // Lama scelta dalla vista «Blades»: filtra le combo su quella lama SENZA toccare `selected`, che è
  // l'inventario dell'utente (Compare, Buildable) e alimenta l'insight «parti più cercate».
  const [bladeFocus, setBladeFocus] = useState<{ id: string; line: 'bx' | 'cx' } | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const rankingRef = useRef<HTMLElement>(null);
  // Negozio Amazon: default neutro in SSR, poi (al mount) lo stato condiviso di lib/marketplace —
  // scelta salvata, paese rilevato o lingua del browser. Così il markup idratato coincide con
  // quello servito, e questo select resta allineato a quello dell'header.
  const markets = Object.keys(amazon.config.marketplaces);
  const [market, setMarket] = useState<string>(amazon.config.defaultMarketplace);
  const [marketSource, setMarketSource] = useState<MarketSource>('default');
  useEffect(() => {
    subscribeMarket(markets, amazon.config.defaultMarketplace, (m, s) => { setMarket(m); setMarketSource(s); });
  }, []);
  const changeMarket = (m: string) => {
    chooseMarket(m);
    track('marketplace_changed', { marketplace: m });
  };
  const [selected, setSelected] = useState<SelectedParts>({ ...emptySelection });
  const [compare, setCompare] = useState(false);
  const [onlyBuildable, setOnlyBuildable] = useState(false);
  const [tournamentOnly, setTournamentOnly] = useState(false);
  const [metaOnly, setMetaOnly] = useState(false);
  const [lineFilter, setLineFilter] = useState<ComboLine[]>([]);
  const [stadiumFilter, setStadiumFilter] = useState<Stadium[]>([]);

  // Il dataset completo arriva come asset separato (~190 KB gzip) invece che come prop dell'isola:
  // nelle props Astro ogni virgoletta diventa &quot; e la home pesava 38,5 MB.
  // Finché non è `ready` si mostrano solo le combo inline, che hanno la sola finestra 365: periodi,
  // ordinamenti e vista lame restano disabilitati, perché ordinare 30 combo per top cut darebbe un #1
  // falso. Un JSON senza la finestra 365 (cache di una versione precedente, con altre chiavi) vale
  // come fallito: con quello ogni periodo darebbe zero risultati.
  useEffect(() => {
    let alive = true;
    fetch(dataUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((full: SlimDatabase) => {
        if (!alive) return;
        if (full?.combos?.length && full.combos[0].windows?.[INLINE_PERIOD]) { setDb(full); setDataset('ready'); }
        else setDataset('failed');
      })
      .catch(() => { if (alive) setDataset('failed'); });
    return () => { alive = false; };
  }, [dataUrl]);
  const ready = dataset === 'ready';

  // Ogni cambio di criterio riparte dalla prima pagina di risultati.
  useEffect(() => { setVisible(PAGE); }, [period, sort, view, bladeFocus, selected, onlyBuildable, tournamentOnly, metaOnly, lineFilter, stadiumFilter]);

  const toggleIn = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const t = (key: string) => translations[key] ?? key;

  const add = (category: PartCategory, id: string) => {
    track('part_added', { category, id, name: resolveName(category, id) });
    setSelected((prev) => (prev[category].includes(id) ? prev : { ...prev, [category]: [...prev[category], id] }));
  };

  const remove = (category: PartCategory, id: string) => {
    track('part_removed', { category, id, name: resolveName(category, id) });
    setSelected((prev) => ({ ...prev, [category]: prev[category].filter((x) => x !== id) }));
  };

  // Filtri booleani: un solo punto che aggiorna lo stato e registra l'evento.
  const toggleFilter = (name: string, setter: (fn: (v: boolean) => boolean) => void, current: boolean) => {
    track('filter_toggled', { name, on: !current });
    setter((v) => !v);
  };
  const changePeriod = (p: WindowKey) => {
    if (p === period) return;
    track('period_changed', { days: Number(p) });
    setPeriod(p);
  };
  const changeSort = (k: SortKey) => {
    if (k === sort) return;
    track('sort_changed', { by: k });
    setSort(k);
  };
  const changeView = (v: View) => {
    if (v === view) return;
    track('view_changed', { view: v });
    setView(v);
    if (v === 'blades') setBladeFocus(null);
  };
  const focusBlade = (id: string, line: 'bx' | 'cx') => {
    track('blade_row_clicked', { blade: id, line, period: Number(period), sort });
    setBladeFocus({ id, line });
    setView('combos');
    rankingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Ricerca blade-centrica: una sola blade selezionata (e nient'altro) = "la miglior combo per la
  // lama X". Restringe il ranking a quella blade e cambia l'intestazione.
  const onlyBlade =
    selected.blades.length === 1 &&
    selected.lockChips.length === 0 && selected.mainBlades.length === 0 &&
    selected.assistBlades.length === 0 && selected.overBlades.length === 0 &&
    selected.ratchets.length === 0 && selected.bits.length === 0;

  let results = filterCombos(db.combos, selected, { period, sort, onlyBuildable, lineFilter, stadiumFilter });
  if (onlyBlade) results = results.filter((c) => c.blade === selected.blades[0]);
  if (tournamentOnly) results = results.filter((c) => c.windows[period]!.tags.includes('tournament-proven'));
  if (metaOnly) results = results.filter((c) => c.windows[period]!.tags.some((tag) => tag === 'meta' || tag === 'top-tier'));
  // Vista lame: si aggrega l'insieme filtrato, prima del fuoco su una lama (che riguarda le combo).
  const bladeRows = view === 'blades' ? aggregateBlades(results, period, sort) : [];
  if (view === 'combos' && bladeFocus) results = results.filter((c) => bladeOf(c) === bladeFocus.id);
  const total = view === 'blades' ? bladeRows.length : results.length;
  const shown = results.slice(0, visible);
  const shownRows = bladeRows.slice(0, visible);
  const thresholds = db.thresholds[period];

  // Fotografia della ricerca: cosa ha selezionato l'utente e quanti risultati vede. Debounce di 500 ms
  // così una raffica di clic produce un evento solo; il primo render (nessuna selezione) è escluso.
  const selectedCount = Object.values(selected).reduce((n, a) => n + a.length, 0);
  useEffect(() => {
    if (selectedCount === 0 && !onlyBuildable && !tournamentOnly && !metaOnly && lineFilter.length === 0 && stadiumFilter.length === 0
      && sort === 'score' && view === 'combos' && !bladeFocus) return;
    const id = setTimeout(() => {
      track('search_results', {
        selectedCount,
        byCategory: Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, v.length])),
        results: total,
        onlyBlade,
        period: Number(period),
        sort,
        view,
        bladeFocus: bladeFocus?.id ?? null,
        filters: { onlyBuildable, tournamentOnly, metaOnly, lines: lineFilter, stadiums: stadiumFilter },
      });
    }, 500);
    return () => clearTimeout(id);
  }, [selected, period, sort, view, bladeFocus, onlyBuildable, tournamentOnly, metaOnly, lineFilter, stadiumFilter, total]);

  const resolveName = (category: PartCategory, id: string): string => {
    const arr = parts[category] as Array<{ id: string; name: string }>;
    return arr.find((p) => p.id === id)?.name ?? id;
  };

  const bladeName = (id: string, line: 'bx' | 'cx') => resolveName(line === 'cx' ? 'mainBlades' : 'blades', id);
  const rankingTitle = view === 'combos' && bladeFocus
    ? `${t('search.bestForBlade')} ${bladeName(bladeFocus.id, bladeFocus.line)}`
    : view === 'combos' && onlyBlade
      ? `${t('search.bestForBlade')} ${resolveName('blades', selected.blades[0])}`
      : t('search.ranking');
  // Riga sotto la barra dei controlli: cosa si sta guardando, o perché i controlli sono spenti.
  const hint = dataset === 'loading'
    ? t('search.loading')
    : dataset === 'failed'
      ? t('search.datasetFailed')
      : t(`hint.${view}.${sort}`).replace('{period}', t(`period.span.${period}`));

  // nome di una parte combo (chiavi singolari: blade/ratchet/...)
  const partName = (category: string, id: string | null): string => {
    if (!id) return '';
    const cat = COMBO_PART_CATEGORY[category];
    return cat ? resolveName(cat, id) : id;
  };

  const comboDisplayName = (combo: SlimCombo): string => {
    // BX e UX: blade + ratchet + bit. Fino al 01/10/2026 solo 'bx': le 62 combo UX finivano nel ramo
    // CX e il nome diventava il solo bit («Kick» per Glory Valkyrie Kick).
    const keys = combo.line !== 'cx'
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

  // Suggerimenti: parti più frequenti nelle top combo (365 giorni, indipendente dal periodo scelto),
  // non ancora possedute. db.combos è già ordinato per windows["365"].score.
  const suggestions: PartRef[] = (() => {
    const top = db.combos.slice(0, 20);
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

  const Pill = ({ active, onToggle, label, accentVar, testId, disabled = false }: { active: boolean; onToggle: () => void; label: string; accentVar: string; testId?: string; disabled?: boolean }) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      title={disabled ? t('search.loading') : undefined}
      onClick={() => { if (!disabled) onToggle(); }}
      class={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
        active ? '' : 'border-border bg-surface-2 text-muted hover:text-text'
      } ${disabled ? 'cursor-not-allowed opacity-40 hover:text-muted' : ''}`}
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
          onClick={() => toggleFilter('compare', setCompare, compare)}
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
            <Pill active={tournamentOnly} onToggle={() => toggleFilter('tournamentOnly', setTournamentOnly, tournamentOnly)} label={t('filter.tournamentProven')} accentVar="--c-scarlet" />
            <Pill active={metaOnly} onToggle={() => toggleFilter('metaOnly', setMetaOnly, metaOnly)} label={t('filter.metaOnly')} accentVar="--c-gold" />
            <Pill active={onlyBuildable} onToggle={() => toggleFilter('onlyBuildable', setOnlyBuildable, onlyBuildable)} label={t('search.onlyBuildable')} accentVar="--c-gold" />
          </div>
          {/* Linea (BX/UX/CX) e stadio: solo filtro/etichetta, non separano il ranking. */}
          <div class="mt-2 flex flex-wrap gap-2">
            {(['bx', 'ux', 'cx'] as ComboLine[]).map((ln) => (
              <Pill key={ln} active={lineFilter.includes(ln)} onToggle={() => { track('filter_toggled', { name: `line:${ln}`, on: !lineFilter.includes(ln) }); setLineFilter((f) => toggleIn(f, ln)); }} label={ln.toUpperCase()} accentVar="--c-cx-text" />
            ))}
            {(['xtreme', 'infinity'] as Stadium[]).map((st) => (
              <Pill key={st} active={stadiumFilter.includes(st)} onToggle={() => { track('filter_toggled', { name: `stadium:${st}`, on: !stadiumFilter.includes(st) }); setStadiumFilter((f) => toggleIn(f, st)); }} label={t(`stadium.${st}`)} accentVar="--c-scarlet" />
            ))}
          </div>
          {/* Negozio Amazon dei link "Buy". La nota dice da dove viene la scelta: senza, chi naviga
              con una VPN vede il negozio sbagliato e non capisce perché. */}
          <label class="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-2">
            <span>{t('search.shopOn')}</span>
            <select
              data-testid="marketplace"
              value={market}
              onChange={(e) => changeMarket((e.target as HTMLSelectElement).value)}
              class="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text"
            >
              {markets.map((k) => (
                <option key={k} value={k}>{amazon.config.marketplaces[k].tld}</option>
              ))}
            </select>
          </label>
          <p data-testid="market-note" class="mt-1 text-[10px] leading-snug text-muted-2">
            {t(marketSource === 'user' ? 'market.note.user' : marketSource === 'geo' ? 'market.note.geo' : 'market.note.lang')}
          </p>
        </div>

        {/* Annuncio nel pannello: su desktop e' la colonna sinistra, su mobile finisce sopra il ranking. */}
        <AdUnit name="rail" class="mt-4" />
      </section>

      {/* ---------- Ranking ---------- */}
      {/* min-w-0: senza, la colonna 1fr della griglia non scende sotto la larghezza del testo più lungo
          su una riga (la «Best build» troncata della vista lame) e la pagina sborda a destra. */}
      <section ref={rankingRef} class="min-w-0 scroll-mt-4">
        {/* Tre controlli del ranking: periodo (finestra calcolata da score:combos), metrica, raggruppamento. */}
        <div class="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('period.label')}>
            <span class="mr-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">{t('period.label')}</span>
            {PERIODS.map((p) => (
              <Pill key={p} active={period === p} onToggle={() => changePeriod(p)} label={t(`period.${p}`)} accentVar="--c-gold" testId={`period-${p}`} disabled={!ready && p !== INLINE_PERIOD} />
            ))}
          </div>
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('sort.label')}>
            <span class="mr-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">{t('sort.label')}</span>
            {SORT_KEYS.map((k) => (
              <Pill key={k} active={sort === k} onToggle={() => changeSort(k)} label={t(`sort.${k}`)} accentVar="--c-gold" testId={`sort-${k}`} disabled={!ready && k !== 'score'} />
            ))}
          </div>
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('view.label')}>
            <span class="mr-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">{t('view.label')}</span>
            {VIEWS.map((v) => (
              <Pill key={v} active={view === v} onToggle={() => changeView(v)} label={t(`view.${v}`)} accentVar="--c-gold" testId={`view-${v}`} disabled={!ready && v !== 'combos'} />
            ))}
          </div>
        </div>
        <p class="mb-3 text-[11px] text-muted-2" data-testid="period-hint" data-dataset={dataset}>{hint}</p>

        <div class="mb-4 flex items-center gap-3">
          <h2 class="font-display text-[18px] uppercase text-text lg:text-[24px]" data-testid="ranking-title">{rankingTitle}</h2>
          {view === 'combos' && bladeFocus && (
            <button
              type="button"
              data-testid="blade-focus-clear"
              onClick={() => { track('blade_focus_cleared', { blade: bladeFocus.id }); setBladeFocus(null); }}
              class="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted transition-colors hover:text-text"
            >
              ✕ {t('blade.clear')}
            </button>
          )}
          <span class="h-0.5 flex-1 rounded-full" style={{ background: 'var(--grad-ranking)' }} aria-hidden="true" />
          <span class="shrink-0 font-mono text-[11px] text-muted-2" data-testid="results-count">
            {total} {t(view === 'blades' ? 'search.bladesUnit' : 'search.combosUnit')}
          </span>
        </div>

        {view === 'blades' ? (
          bladeRows.length === 0 ? (
            <div class="rounded-[14px] border border-border bg-surface p-8 text-center">
              <p class="text-sm text-muted-2">{t('search.noResults')}</p>
            </div>
          ) : (
            <div class="flex flex-col gap-3 lg:gap-2.5">
              {shownRows.map((row, i) => (
                <BladeRow
                  key={row.blade}
                  row={row}
                  rank={i + 1}
                  period={period}
                  sort={sort}
                  thresholds={thresholds}
                  name={bladeName(row.blade, row.line)}
                  bestName={comboDisplayName(row.best)}
                  owned={compare && [...selected.blades, ...selected.mainBlades].includes(row.blade)}
                  onSelect={() => focusBlade(row.blade, row.line)}
                  t={t}
                />
              ))}
            </div>
          )
        ) : results.length === 0 ? (
          <div class="rounded-[14px] border border-border bg-surface p-8 text-center">
            <p class="text-sm text-muted-2">{t('search.noResults')}</p>
          </div>
        ) : (
          <div class="flex flex-col gap-3 lg:gap-2.5">
            {shown.flatMap((combo, i) => {
              const card = (
                <ComboCard
                  key={combo.id}
                  combo={combo}
                  view={combo.windows[period]!}
                  thresholds={thresholds}
                  displayName={comboDisplayName(combo)}
                  selected={selected}
                  compare={compare}
                  locale={locale}
                  rank={i + 1}
                  sort={sort}
                  partName={partName}
                  amazon={{ ...amazon, market, keepStore: marketSource === 'user' }}
                  t={t}
                />
              );
              // Annuncio dopo la INFEED_AFTER-esima card, poi ogni INFEED_EVERY: la key dipende dalla
              // posizione, non dalla combo, cosi' un cambio di filtro non smonta (e non ricarica) lo slot.
              const pos = i + 1;
              const isAdSpot = pos === INFEED_AFTER || (pos > INFEED_AFTER && (pos - INFEED_AFTER) % INFEED_EVERY === 0);
              if (!isAdSpot || i === shown.length - 1) return [card];
              return [card, <AdUnit key={`ad-infeed-${pos}`} name="infeed" class="my-1" />];
            })}
          </div>
        )}

        {total > visible && (
          <div class="mt-4 text-center">
            <button
              type="button"
              data-testid="load-more"
              onClick={() => { track('load_more', { visible: visible + PAGE, results: total, view }); setVisible((v) => v + PAGE); }}
              class="rounded-full border border-border bg-surface-2 px-5 py-2 text-[12px] font-semibold text-muted transition-colors hover:text-text"
            >
              {t('search.loadMore')} ({total - visible})
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
