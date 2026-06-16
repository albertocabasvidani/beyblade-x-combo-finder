import type { Combo } from '../../lib/types';

export type TierKey = 'meta' | 'top' | 'solid' | 'base';

export interface Tier {
  key: TierKey;
  labelKey: string;
  gradVar: string;
  inkVar: string;
  fillVar: string;
}

// Fascia CAS: tag gestiti dallo scoring + soglie assolute (vedi src/lib/scoring.ts: meta ≥8.5, top ≥7).
export function scoreTier(combo: Combo): Tier {
  const tags = combo.tags ?? [];
  if (tags.includes('meta') || combo.score >= 8.5)
    return { key: 'meta', labelKey: 'tier.meta', gradVar: '--grad-tier-meta', inkVar: '--ink-tier-meta', fillVar: '--fill-1' };
  if (tags.includes('top-tier') || combo.score >= 7)
    return { key: 'top', labelKey: 'tier.topTier', gradVar: '--grad-tier-top', inkVar: '--ink-tier-top', fillVar: '--fill-2' };
  if (combo.score >= 5.5)
    return { key: 'solid', labelKey: 'tier.solid', gradVar: '--grad-tier-solid', inkVar: '--ink-tier-solid', fillVar: '--fill-3' };
  return { key: 'base', labelKey: 'tier.base', gradVar: '--grad-tier-base', inkVar: '--ink-tier-base', fillVar: '--fill-3' };
}

interface Props {
  combo: Combo;
  t: (key: string) => string;
  size?: 'sm' | 'lg';
  title?: string;
}

// Badge CAS "notch" (gettone con punta verso il basso) — gradiente per fascia.
export function ScoreBadge({ combo, t, size = 'sm', title }: Props) {
  const tier = scoreTier(combo);
  const big = size === 'lg';
  return (
    <div
      title={title}
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
        {combo.score.toFixed(1)}
      </div>
      <div class="font-bold uppercase" style={{ fontSize: big ? '8.5px' : '7.5px', letterSpacing: '0.08em', marginTop: '2px' }}>
        {t(tier.labelKey)}
      </div>
    </div>
  );
}
