import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { Locale, ComboWindow, TierThresholds } from '../../lib/types';
import type { SlimCombo } from '../../lib/slim-combos';
import { bladeOf, type SortKey } from '../../lib/search-engine';
import { buildAmazonUrl, type AmazonConfigFile, type AsinIndex, type PartLookup } from '../../lib/amazon';
import { track } from '../../lib/analytics';
import { ScoreBadge, scoreTier } from './score-badge';
import { PartThumb } from './part-thumb';

interface Props {
  combo: SlimCombo;
  /** La finestra temporale scelta dall'utente: score, breakdown e tag da mostrare. */
  view: ComboWindow;
  thresholds: TierThresholds;
  /** Link affiliati (chip delle parti mancanti e pannello «Buy parts»); assente = nessun link. */
  /** `keepStore`: il negozio l'ha scelto il visitatore, quindi Amazon non deve spostarlo (OneLink). */
  /** `note`: da dove viene il negozio (rilevato, scelto, lingua): il selettore sta nell'header. */
  amazon?: { config: AmazonConfigFile; lookup: PartLookup; asins: AsinIndex; market: string; keepStore?: boolean; note?: string };
  displayName: string;
  locale: Locale;
  rank: number;
  /** Metrica scelta in «Sort by»: nella riga evidenza è la sola sottolineata. */
  sort: SortKey;
  partName: (category: string, id: string | null) => string;
  /** File della foto di una parte (campo `image` del registro); undefined = nessuna foto. */
  partImage: (category: string, id: string | null) => string | undefined;
  t: (key: string) => string;
}

const STALE_DAYS = 45;   // oltre, l'evidenza più recente è considerata "datata"

function fmtDate(iso: string, locale: Locale): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-US', { day: '2-digit', month: 'short' });
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso + 'T00:00:00Z').getTime()) / 86_400_000;
}

/** Classe di un valore della riga evidenza: oro e sottolineato se è la metrica dell'ordinamento. */
/**
 * Nome di una combo con i ratchet («9-60») indivisibili: altrimenti il browser va a capo sul trattino
 * e lascia «9-» in fondo a una riga e «60 KICK» sulla successiva. Il testo resta identico.
 */
export const comboNameNodes = (name: string) =>
  name.split(' ').map((w, i) => (
    <Fragment key={i}>{i > 0 && ' '}{w.includes('-') ? <span class="whitespace-nowrap">{w}</span> : w}</Fragment>
  ));

/** «1 win», «2 wins»: la chiave `<key>.one` porta il singolare. */
export const countLabel = (n: number, key: string, t: (k: string) => string) => `${n} ${t(n === 1 ? `${key}.one` : key)}`;

export const metricClass = (on: boolean) =>
  on ? 'font-bold text-gold underline decoration-2 underline-offset-4' : '';

export function ComboCard({ combo, view, thresholds, amazon, displayName, locale, rank, sort, partName, partImage, t }: Props) {
  const [buyOpen, setBuyOpen] = useState(false);
  const b = view;
  const tier = scoreTier(view.score, view.tags, thresholds);
  const isTop = rank === 1;

  const breakdownTooltip = b
    ? `${t('combo.perf')} ${b.performance} · ${t('combo.pres')} ${b.presence} · ${t('combo.corr')} ${b.corroboration}`
    : undefined;

  const parts = combo.line !== 'cx'
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

  // Foto delle parti, nell'ordine del nome (blade, ratchet, bit; per le CX lock chip → bit).
  const Thumbs = ({ size }: { size: number }) => (
    <div data-testid="combo-thumbs" class="flex flex-wrap gap-1.5">
      {parts.filter((p) => p.id).map((p) => (
        <PartThumb key={p.key} file={partImage(p.key, p.id)} name={partName(p.key, p.id) || p.key} size={size} />
      ))}
    </div>
  );

  const CxBadge = () =>
    combo.line === 'cx' ? (
      <span class="shrink-0 rounded-[4px] border border-cx-border bg-cx-bg px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-cx-text">
        CX
      </span>
    ) : null;

  const Sources = () => (
    <span class="text-[10.5px] text-muted-2">
      {countLabel(combo.sourceCount, 'search.sources', t)}
    </span>
  );

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

  // ---------- «Buy parts»: link affiliati a TUTTE le parti della combo ----------
  // L'unica superficie affiliata della card (i chip ✓/! del confronto con le proprie parti sono stati
  // tolti il 02/10/2026). Chiuso di default per non allungare 60 card; l'apertura e' un evento
  // PostHog, cosi' si misura se conviene aprirlo sempre.
  const buyable = amazon ? parts.filter((p) => p.id) : [];

  const toggleBuy = () => {
    const next = !buyOpen;
    setBuyOpen(next);
    if (next && amazon) track('buy_parts_opened', { comboId: combo.id, line: combo.line, marketplace: amazon.market, rank });
  };

  const BuyToggle = ({ compact = false }: { compact?: boolean }) =>
    buyable.length === 0 ? null : (
      <button
        type="button"
        data-testid="buy-parts-toggle"
        aria-expanded={buyOpen}
        onClick={toggleBuy}
        class={`shrink-0 rounded-full border font-bold text-gold transition-opacity hover:opacity-80 ${
          compact ? 'px-2.5 py-1 text-[10.5px]' : 'px-3 py-1 text-[11px]'
        }`}
        style={{ borderColor: 'var(--c-gold)', background: 'color-mix(in srgb, var(--c-gold) 14%, transparent)' }}
      >
        {t('combo.buyParts')} {buyOpen ? '▴' : '▾'}
      </button>
    );

  const BuyPanel = () =>
    !buyOpen || !amazon ? null : (
      <div data-testid="buy-parts-panel" class="mt-2.5 border-t border-hairline pt-2.5">
        <div class="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
          {t('combo.buyOn')} {amazon.config.marketplaces[amazon.market]?.tld ?? ''}
        </div>
        {amazon.note && <p data-testid="market-note" class="-mt-1 mb-1.5 text-[10.5px] leading-snug text-muted-2">{amazon.note}</p>}
        <div class="flex flex-wrap gap-1.5">
          {buyable.map((p) => {
            const label = partName(p.key, p.id) || p.key;
            const { href, kind } = buildAmazonUrl(p.key, p.id!, label, amazon.lookup, amazon.asins, amazon.market, amazon.config, amazon.keepStore);
            return (
              <a
                key={p.key}
                data-testid="buy-part"
                href={href}
                target="_blank"
                rel="sponsored noopener nofollow"
                class="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-text transition-colors hover:text-gold"
                onClick={() => track('amazon_click', { partId: p.id, category: p.key, marketplace: amazon.market, kind, comboId: combo.id, source: 'buy-parts' })}
              >
                {label}
              </a>
            );
          })}
        </div>
      </div>
    );

  const EvidenceInline = () =>
    b && (b.tournamentEvents > 0 || b.metaSharePct != null) ? (
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] font-semibold text-text-2" title={breakdownTooltip}>
        {b.wins > 0 && <span>{'\u{1F3C6}'} <span data-metric="wins" class={metricClass(sort === 'wins')}>{countLabel(b.wins, 'combo.wins', t)}</span></span>}
        {b.topCutAppearances > 0 && <span data-metric="topCut" class={metricClass(sort === 'topCut')}>{countLabel(b.topCutAppearances, 'combo.topCuts', t)}</span>}
        {b.tournamentEvents > 0 && <span>{countLabel(b.tournamentEvents, 'combo.events', t)}</span>}
        {b.metaSharePct != null && <span class="text-scarlet">{b.metaSharePct}% {t('combo.metaShare')}</span>}
        <Freshness />
      </div>
    ) : null;

  return (
    <>
      {/* ---------- MOBILE e desktop stretto: card verticale ----------
          Fino a 1279 px: fra 1024 e 1279 la colonna del ranking è larga ~580 px e nella riga
          orizzontale al nome restavano ~110 px (nome su due righe, foto a capo). */}
      <article data-testid="combo-card" data-combo-id={combo.id} data-blade={bladeOf(combo) ?? undefined} data-line={combo.line} class={`relative overflow-hidden rounded-[14px] xl:hidden ${cardClass}`} style={cardStyle}>
        <span class="absolute inset-y-0 left-0 w-1" style={{ background: railBg }} aria-hidden="true" />
        <div class="py-[13px] pl-[18px] pr-[14px]">
          <div class="flex items-start justify-between gap-2.5">
            <div class="flex min-w-0 items-start gap-2.5">
              <span class={`font-display text-[26px] italic leading-none ${isTop ? 'text-rank-1' : 'text-rank-other'}`}>{rank}</span>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <CxBadge />
                  <h3 class="font-display text-[17px] uppercase leading-tight text-text">{comboNameNodes(displayName)}</h3>
                </div>
                <div class="mt-1">
                  <Sources />
                </div>
              </div>
            </div>
            <ScoreBadge score={view.score} tags={view.tags} thresholds={thresholds} t={t} size="sm" title={breakdownTooltip} />
          </div>

          <div class="mt-2.5">
            <Thumbs size={44} />
          </div>

          {b && (b.tournamentEvents > 0 || b.metaSharePct != null) && (
            <div class="mt-[11px] border-t border-hairline pt-[11px]">
              <EvidenceInline />
            </div>
          )}

          {combo.notes && <p class="mt-2 text-[11px] leading-snug text-muted-2">{combo.notes}</p>}

          {/* «Buy parts» in fondo alla card: in testa occupava una riga da solo sotto il nome. */}
          {buyable.length > 0 && (
            <div class="mt-2.5">
              <BuyToggle compact />
            </div>
          )}
          <BuyPanel />
        </div>
      </article>

      {/* ---------- DESKTOP largo (≥1280): riga orizzontale. Foto da 42 px ed evidenza da 240:
          così anche una CX a 6 parti tiene le foto su una riga. ---------- */}
      <article data-testid="combo-card" data-combo-id={combo.id} data-blade={bladeOf(combo) ?? undefined} data-line={combo.line} class={`relative hidden overflow-hidden rounded-[14px] xl:block ${cardClass}`} style={cardStyle}>
        <span class="absolute inset-y-0 left-0 w-[5px]" style={{ background: railBg }} aria-hidden="true" />
        <div class="py-4 pl-[26px] pr-5">
        <div class="flex items-center gap-[18px]">
          <span class={`font-display text-[38px] italic leading-none ${isTop ? 'text-rank-1' : 'text-rank-other'}`}>{rank}</span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <CxBadge />
              <h3 class="font-display text-[22px] uppercase leading-tight text-text">{comboNameNodes(displayName)}</h3>
            </div>
            <div class="mt-2">
              <Thumbs size={42} />
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <Sources />
              <BuyToggle compact />
            </div>
          </div>

          {b && (b.tournamentEvents > 0 || b.metaSharePct != null) && (
            <div class="w-[240px] shrink-0 border-l border-hairline pl-[18px] text-[12.5px]">
              <div class="font-semibold leading-relaxed text-text-2">
                {b.wins > 0 && <span>{'\u{1F3C6}'} <span data-metric="wins" class={metricClass(sort === 'wins')}>{countLabel(b.wins, 'combo.wins', t)}</span> {'·'} </span>}
                {b.topCutAppearances > 0 && <span data-metric="topCut" class={metricClass(sort === 'topCut')}>{countLabel(b.topCutAppearances, 'combo.topCuts', t)}</span>}
                {b.tournamentEvents > 0 && <span> {'·'} {countLabel(b.tournamentEvents, 'combo.events', t)}</span>}
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

          <ScoreBadge score={view.score} tags={view.tags} thresholds={thresholds} t={t} size="lg" title={breakdownTooltip} />
        </div>
        <BuyPanel />
        </div>
      </article>
    </>
  );
}
