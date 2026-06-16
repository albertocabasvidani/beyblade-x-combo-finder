import type { Combo, SelectedParts, Locale } from '../../lib/types';
import { getMatchedParts, hasAnySelection } from '../../lib/search-engine';
import { ScoreBadge, scoreTier } from './score-badge';

interface Props {
  combo: Combo;
  displayName: string;
  selected: SelectedParts;
  compare: boolean;
  locale: Locale;
  rank: number;
  partName: (category: string, id: string | null) => string;
  t: (key: string) => string;
}

const typeLabels: Record<string, Record<string, string>> = {
  en: { attack: 'Attack', defense: 'Defense', stamina: 'Stamina', balance: 'Balance' },
  it: { attack: 'Attacco', defense: 'Difesa', stamina: 'Resistenza', balance: 'Equilibrio' },
};

const typeBg: Record<string, string> = {
  attack: 'bg-attack',
  defense: 'bg-defense',
  stamina: 'bg-stamina',
  balance: 'bg-balance',
};

const STALE_DAYS = 45;   // oltre, l'evidenza più recente è considerata "datata"

function fmtDate(iso: string, locale: Locale): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-US', { day: '2-digit', month: 'short' });
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso + 'T00:00:00Z').getTime()) / 86_400_000;
}

export function ComboCard({ combo, displayName, selected, compare, locale, rank, partName, t }: Props) {
  const matched = getMatchedParts(combo, selected);
  const b = combo.scoreBreakdown;
  const tier = scoreTier(combo);
  const isTop = rank === 1;
  const showChips = compare && hasAnySelection(selected);

  const breakdownTooltip = b
    ? `${t('combo.perf')} ${b.performance} · ${t('combo.pres')} ${b.presence} · ${t('combo.corr')} ${b.corroboration}`
    : undefined;

  const parts = combo.line === 'bx'
    ? [
        { key: 'blade', id: combo.blade },
        { key: 'ratchet', id: combo.ratchet },
        { key: 'bit', id: combo.bit },
      ]
    : [
        { key: 'lockChip', id: combo.lockChip },
        { key: 'overBlade', id: combo.overBlade ?? null },
        { key: 'mainBlade', id: combo.mainBlade },
        { key: 'assistBlade', id: combo.assistBlade },
        { key: 'ratchet', id: combo.ratchet },
        { key: 'bit', id: combo.bit },
      ];

  // striscia laterale: #1 oro→scarlatto, CX viola, altrimenti neutro
  const railBg = isTop ? 'var(--rail-1)' : combo.line === 'cx' ? 'var(--rail-cx)' : 'var(--rail-2)';
  const cardStyle = isTop
    ? { background: 'var(--card1-bg)', borderColor: 'var(--card1-border)', boxShadow: 'var(--shadow-card1)' }
    : { boxShadow: 'var(--shadow-card)' };
  const cardClass = isTop ? 'border' : 'border border-border bg-surface';

  const CxBadge = () =>
    combo.line === 'cx' ? (
      <span class="shrink-0 rounded-[4px] border border-cx-border bg-cx-bg px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-cx-text">
        CX
      </span>
    ) : null;

  const TypeBadge = () => (
    <span class={`shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-white ${typeBg[combo.type] ?? 'bg-muted'}`}>
      {typeLabels[locale]?.[combo.type] ?? combo.type}
    </span>
  );

  const Sources = () => (
    <span class="text-[10.5px] text-muted-2">
      {combo.sources.length} {t('search.sources')}
    </span>
  );

  const StadiumBadge = () =>
    b?.stadiums && b.stadiums.length > 0 ? (
      <span class="shrink-0 rounded-[4px] border border-border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-muted">
        {b.stadiums.map((s) => t(`stadium.${s}`)).join(' / ')}
      </span>
    ) : null;

  // Freschezza (data ultimo podio) + trend del meta-share. Il trend appare solo con ≥2 snapshot
  // usage accumulati; finché manca lo storico resta nascosto.
  const Freshness = () =>
    b?.lastPlacementDate ? (
      <span class={`inline-flex items-center gap-1 ${daysSince(b.lastPlacementDate) > STALE_DAYS ? 'text-muted-2' : 'text-muted'}`}>
        {t('combo.lastSeen')} {fmtDate(b.lastPlacementDate, locale)}
        {b.usageTrend === 'up' && <span class="text-owned-text" title={t('combo.trendUp')}>▲</span>}
        {b.usageTrend === 'down' && <span class="text-missing-text" title={t('combo.trendDown')}>▼</span>}
      </span>
    ) : null;

  const PartChips = ({ dense = false }: { dense?: boolean }) =>
    !showChips ? null : (
      <div class={`flex flex-wrap ${dense ? 'gap-1.5' : 'gap-2'}`}>
        {parts.map((p) => {
          const status = matched[p.key];
          if (status === 'unset') return null;
          const owned = status === 'owned';
          const label = partName(p.key, p.id) || p.key;
          return (
            <span
              key={p.key}
              class={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                owned ? 'border-owned-border bg-owned-bg text-owned-text' : 'border-missing-border bg-missing-bg text-missing-text'
              }`}
            >
              {owned ? '✓' : '!'} {label}
            </span>
          );
        })}
      </div>
    );

  const EvidenceInline = () =>
    b && (b.tournamentEvents > 0 || b.metaSharePct != null) ? (
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] font-semibold text-text-2" title={breakdownTooltip}>
        {b.wins > 0 && <span class="text-gold">{'\u{1F3C6}'} {b.wins} {t('combo.wins')}</span>}
        {b.tournamentEvents > 0 && <span>{b.tournamentEvents} {t('combo.events')}</span>}
        {b.metaSharePct != null && <span class="text-scarlet">{b.metaSharePct}% {t('combo.metaShare')}</span>}
        <Freshness />
      </div>
    ) : null;

  return (
    <>
      {/* ---------- MOBILE: card verticale ---------- */}
      <article class={`relative overflow-hidden rounded-[14px] lg:hidden ${cardClass}`} style={cardStyle}>
        <span class="absolute inset-y-0 left-0 w-1" style={{ background: railBg }} aria-hidden="true" />
        <div class="py-[13px] pl-[18px] pr-[14px]">
          <div class="flex items-start justify-between gap-2.5">
            <div class="flex min-w-0 items-start gap-2.5">
              <span class={`font-display text-[26px] italic leading-none ${isTop ? 'text-rank-1' : 'text-rank-other'}`}>{rank}</span>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <CxBadge />
                  <h3 class="font-display text-[17px] uppercase leading-tight text-text">{displayName}</h3>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-2">
                  <TypeBadge />
                  <StadiumBadge />
                  <Sources />
                </div>
              </div>
            </div>
            <ScoreBadge combo={combo} t={t} size="sm" title={breakdownTooltip} />
          </div>

          {b && (b.tournamentEvents > 0 || b.metaSharePct != null) && (
            <div class="mt-[11px] border-t border-hairline pt-[11px]">
              <EvidenceInline />
            </div>
          )}

          {showChips && (
            <div class="mt-2.5">
              <PartChips />
            </div>
          )}

          {combo.notes && <p class="mt-2 text-[11px] leading-snug text-muted-2">{combo.notes}</p>}
        </div>
      </article>

      {/* ---------- DESKTOP: riga orizzontale ---------- */}
      <article class={`relative hidden overflow-hidden rounded-[14px] lg:block ${cardClass}`} style={cardStyle}>
        <span class="absolute inset-y-0 left-0 w-[5px]" style={{ background: railBg }} aria-hidden="true" />
        <div class="flex items-center gap-[18px] py-4 pl-[26px] pr-5">
          <span class={`font-display text-[38px] italic leading-none ${isTop ? 'text-rank-1' : 'text-rank-other'}`}>{rank}</span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <CxBadge />
              <h3 class="font-display text-[22px] uppercase leading-tight text-text">{displayName}</h3>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <TypeBadge />
              <StadiumBadge />
              {showChips ? <PartChips dense /> : <Sources />}
            </div>
          </div>

          {b && (b.tournamentEvents > 0 || b.metaSharePct != null) && (
            <div class="w-[188px] shrink-0 border-l border-hairline pl-[18px] text-[12.5px]">
              <div class="font-semibold text-text-2">
                {b.wins > 0 && <span class="text-gold">{'\u{1F3C6}'} {b.wins} {t('combo.wins')}</span>}
                {b.tournamentEvents > 0 && <span> {'·'} {b.tournamentEvents} {t('combo.events')}</span>}
              </div>
              {b.metaSharePct != null && (
                <>
                  <div class="mt-0.5 font-semibold text-scarlet">{b.metaSharePct}% {t('combo.metaShare')}</div>
                  <div class="mt-1.5 h-[5px] overflow-hidden rounded-[3px]" style={{ background: 'var(--c-track)' }}>
                    <div class="h-full" style={{ width: `${Math.max(b.metaSharePct, 3)}%`, background: `var(${tier.fillVar})` }} />
                  </div>
                </>
              )}
              {b.lastPlacementDate && (
                <div class="mt-1.5 text-[10.5px] font-medium"><Freshness /></div>
              )}
            </div>
          )}

          <ScoreBadge combo={combo} t={t} size="lg" title={breakdownTooltip} />
        </div>
      </article>
    </>
  );
}
