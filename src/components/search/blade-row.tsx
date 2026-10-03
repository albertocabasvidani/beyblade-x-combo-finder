import type { TierThresholds, WindowKey } from '../../lib/types';
import type { BladeRow as Row, SortKey } from '../../lib/search-engine';
import { ScoreBadge } from './score-badge';
import { metricClass, comboNameNodes } from './combo-card';
import { PartThumb } from './part-thumb';

interface Props {
  row: Row;
  rank: number;
  period: WindowKey;
  sort: SortKey;
  thresholds: TierThresholds;
  /** Nome leggibile della lama (Blade o Main Blade) e della sua build migliore. */
  name: string;
  bestName: string;
  /** Foto della lama (campo `image` del registro). */
  image?: string;
  onSelect: () => void;
  t: (key: string) => string;
}

/**
 * Riga della vista «Blades»: una lama con la somma delle sue combo nella finestra. Stessa anatomia
 * della combo card (striscia, rank, nome in Anton, colonna evidenza, badge CAS) perché la lista si
 * legga allo stesso modo; il badge è quello della build migliore, non uno score della lama. Tutta la
 * riga è un pulsante: porta alle combo di quella lama.
 */
export function BladeRow({ row, rank, period, sort, thresholds, name, bestName, image, onSelect, t }: Props) {
  const best = row.best.windows[period]!;
  const isTop = rank === 1;
  const railBg = isTop ? 'var(--rail-1)' : row.line === 'cx' ? 'var(--rail-cx)' : 'var(--rail-2)';
  const cardStyle = isTop
    ? { background: 'var(--card1-bg)', borderColor: 'var(--card1-border)', boxShadow: 'var(--shadow-card1)' }
    : { boxShadow: 'var(--shadow-card)' };
  const pct = `${(100 * row.share).toFixed(1)}%`;
  const bestMetric = sort === 'wins' ? `${best.wins} ${t('combo.wins')}` : `${best.topCutAppearances} ${t('combo.topCuts')}`;

  const Name = () => (
    <div class="flex min-w-0 items-center gap-2">
      <span class="font-display uppercase leading-tight text-text text-[17px] lg:text-[22px]">{name}</span>
      {row.line === 'cx' && (
        <span class="shrink-0 rounded-[4px] border border-cx-border bg-cx-bg px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-cx-text">CX</span>
      )}
    </div>
  );
  const Best = () => (
    <div class="mt-1 text-[12px] text-text-2 lg:truncate">
      <span class="text-muted">{t('blade.best')}</span> {comboNameNodes(bestName)} <span class="text-muted">({bestMetric})</span>
    </div>
  );
  const TopCuts = () => <span data-metric="topCut" class={metricClass(sort === 'topCut')}>{row.topCut} {t('combo.topCuts')}</span>;
  const Wins = () => <span>{'\u{1F3C6}'} <span data-metric="wins" class={metricClass(sort === 'wins')}>{row.wins} {t('combo.wins')}</span></span>;
  const Share = () => <span>{pct} {t('blade.share')}</span>;
  const Builds = () => <span>{row.builds} {t('blade.builds')}</span>;

  return (
    <button
      type="button"
      data-testid="blade-row"
      data-blade={row.blade}
      data-line={row.line}
      onClick={onSelect}
      title={t('blade.open')}
      class={`relative block w-full overflow-hidden rounded-[14px] text-left transition-transform hover:-translate-y-px ${isTop ? 'border' : 'border border-border bg-surface'}`}
      style={cardStyle}
    >
      <span class="absolute inset-y-0 left-0 w-1 lg:w-[5px]" style={{ background: railBg }} aria-hidden="true" />

      {/* Mobile: blocco verticale */}
      <div class="py-[13px] pl-[18px] pr-[14px] lg:hidden">
        <div class="flex items-start justify-between gap-2.5">
          <div class="flex min-w-0 items-start gap-2.5">
            <span class={`font-display text-[26px] italic leading-none ${isTop ? 'text-rank-1' : 'text-rank-other'}`}>{rank}</span>
            <PartThumb file={image} name={name} size={44} />
            <div class="min-w-0"><Name /><Best /></div>
          </div>
          <ScoreBadge score={best.score} tags={best.tags} thresholds={thresholds} t={t} size="sm" />
        </div>
        <div class="mt-[11px] flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-hairline pt-[11px] text-[11.5px] font-semibold text-text-2">
          <TopCuts /><Share /><Wins /><Builds />
        </div>
      </div>

      {/* Desktop: riga orizzontale */}
      <div class="hidden items-center gap-[18px] py-4 pl-[26px] pr-5 lg:flex">
        <span class={`font-display text-[38px] italic leading-none ${isTop ? 'text-rank-1' : 'text-rank-other'}`}>{rank}</span>
        <PartThumb file={image} name={name} size={56} />
        <div class="min-w-0 flex-1"><Name /><Best /></div>
        <div class="w-[260px] shrink-0 border-l border-hairline pl-[18px] text-[12.5px] font-semibold leading-relaxed text-text-2">
          <div><TopCuts /> {'·'} <Share /></div>
          <div><Wins /> {'·'} <Builds /></div>
        </div>
        <ScoreBadge score={best.score} tags={best.tags} thresholds={thresholds} t={t} size="lg" />
      </div>
    </button>
  );
}
