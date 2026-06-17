/**
 * youtube-relevance.ts — Pre-filtro DETERMINISTICO di rilevanza dei video YouTube.
 *
 * Scarta SOLO il rumore evidente prima del giudizio IA e del download transcript:
 *  - franchise estranei (Pokémon, Witcher, ...) senza segnale Beyblade;
 *  - video senza alcun segnale "beyblade" su titolo + descrizione + tag.
 *
 * NON decide la rilevanza competitiva (meta/combo/torneo) né distingue Beyblade X da Burst:
 * quello è un giudizio non-deterministico e lo fa l'IA in /judge-youtube. Qui niente keyword di
 * "competitività" multilingua: sarebbe fragile e rifarebbe il bug del vecchio filtro EN-only.
 *
 * Funzione pura, testabile in isolamento. Vedi piano: filtro ibrido pipeline YouTube.
 */

/** Campi minimi che il pre-filtro ispeziona (sottoinsieme di VideoEntry). */
export interface RelevanceInput {
  title: string;
  description?: string;
  tags?: string[];
  channelId?: string;
}

export type PrefilterVerdict = 'pass' | 'drop';

export interface PrefilterResult {
  verdict: PrefilterVerdict;
  reason: string;
}

/**
 * Franchise/giochi estranei. Se presenti SENZA un segnale Beyblade, il video è off-topic
 * (es. PoKSmon che pubblica Pokémon Unite). Tutto lowercase, match su substring.
 */
export const FRANCHISE_BLOCKLIST: string[] = [
  'pokemon unite', 'pokémon unite', 'pokemon go', 'pokémon go', 'pokemon tcg', 'pokémon tcg',
  'the witcher', 'genshin', 'honkai', 'fortnite', 'minecraft', 'roblox', 'valorant',
  'clash royale', 'clash of clans', 'brawl stars', 'league of legends', 'mobile legends',
  'call of duty', 'gta', 'fc 25', 'fifa', 'ea sports', 'yu-gi-oh', 'yugioh', 'duel links',
  'one piece card', 'magic the gathering', 'beyblade burst', // Burst NON è Beyblade X
];

/**
 * Segnale minimo "è Beyblade (X)", multilingua. Inclusivo di proposito: la selezione fine
 * (X vs Burst, competitivo vs casual) la fa l'IA. Tutto lowercase, match su substring.
 */
export const BEYBLADE_SIGNAL: string[] = [
  'beyblade', 'beible', 'bey blade', 'bbx', 'beyblade x',
  'ベイブレード', 'ベイブレードx', 'ベイブレードエックス', // JP
  '베이블레이드', '베이블레이드x', // KO
  '战斗陀螺', '戰鬥陀螺', '爆裂世代', // ZH (semplificato/tradizionale)
];

const lc = (s?: string) => (s ?? '').toLowerCase();

function buildHaystack(v: RelevanceInput): string {
  return [lc(v.title), lc(v.description), (v.tags ?? []).map(lc).join(' ')].join(' ');
}

function hasBeybladeSignal(hay: string): boolean {
  return BEYBLADE_SIGNAL.some((s) => hay.includes(s));
}

/**
 * Verdetto deterministico su un singolo video.
 *  - drop 'foreign-franchise': franchise estraneo presente e nessun segnale Beyblade;
 *  - drop 'no-beyblade-signal': nessun segnale Beyblade su titolo+descrizione+tag;
 *  - pass: tutto il resto (il giudizio competitivo lo fa l'IA).
 */
export function prefilter(v: RelevanceInput): PrefilterResult {
  const hay = buildHaystack(v);
  const beyblade = hasBeybladeSignal(hay);

  if (!beyblade) {
    const foreign = FRANCHISE_BLOCKLIST.find((f) => hay.includes(f));
    if (foreign) return { verdict: 'drop', reason: `foreign-franchise:${foreign}` };
    return { verdict: 'drop', reason: 'no-beyblade-signal' };
  }

  // Ha il segnale Beyblade: passa anche se cita un altro franchise (es. confronto/crossover).
  return { verdict: 'pass', reason: 'beyblade-signal' };
}
