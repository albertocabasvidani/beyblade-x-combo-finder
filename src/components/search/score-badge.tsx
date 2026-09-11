import type { TierThresholds } from '../../lib/types';

export type TierKey = 'meta' | 'top' | 'solid' | 'base';

export interface Tier {
  key: TierKey;
  labelKey: string;
  gradVar: string;
  inkVar: string;
  fillVar: string;
}

// Fascia CAS: tag gestiti dallo scoring + soglie della finestra corrente (db.windowThresholds,
// scritte da score:combos; oggi 8.5 / 7.0 / 5.5 per tutte le finestre, vedi docs/scoring-algorithm.md).
export function scoreTier(score: number, tags: string[], th: TierThresholds): Tier {
  if (tags.includes('meta') || score >= th.meta)
    return { key: 'meta', labelKey: 'tier.meta', gradVar: '--grad-tier-meta', inkVar: '--ink-tier-meta', fillVar: '--fill-1' };
  if (tags.includes('top-tier') || score >= th.top)
    return { key: 'top', labelKey: 'tier.topTier', gradVar: '--grad-tier-top', inkVar: '--ink-tier-top', fillVar: '--fill-2' };
  if (score >= th.solid)
    return { key: 'solid', labelKey: 'tier.solid', gradVar: '--grad-tier-solid', inkVar: '--ink-tier-solid', fillVar: '--fill-3' };
  return { key: 'base', labelKey: 'tier.base', gradVar: '--grad-tier-base', inkVar: '--ink-tier-base', fillVar: '--fill-3' };
}

interface Props {
  score: number;
  tags: string[];
  thresholds: TierThresholds;
  t: (key: string) => string;
  size?: 'sm' | 'lg';
  title?: string;
}

// Badge CAS "notch" (gettone con punta verso il basso) — gradiente per fascia.
export function ScoreBadge({ score, tags, thresholds, t, size = 'sm', title }: Props) {
  const tier = scoreTier(score, tags, thresholds);
  const big = size === 'lg';
  return (
    <div
      title={title}
      data-testid="score-badge"
      class="shrink-0 text-center"
      style={{
        background: `var(${tier.gradVar})`,
        color: `var(${tier.inkVar})`,
        clipPath: 'polygon(0 0, 100% 0, 100% 80%, 50% 100%, 0 80%)',
        padding: big ? '7px 14px 13px' : '5px 11px 10px',
        minWidth: big ? '60px' : '50px',
      }}
    >
      <div class="font-display italic leading-none" style={{ fontSize: big ? '30px' : '22px' }}>
        {score.toFixed(1)}
      </div>
      <div class="font-bold uppercase" style={{ fontSize: big ? '8.5px' : '7.5px', letterSpacing: '0.08em', marginTop: '2px' }}>
        {t(tier.labelKey)}
      </div>
    </div>
  );
}
