// Beyblade X part types

export type BladeType = 'attack' | 'defense' | 'stamina' | 'balance';
export type BitType = 'attack' | 'defense' | 'stamina' | 'balance';
export type ComboLine = 'bx' | 'ux' | 'cx';

// Stat di gioco a 3 assi (Attack/Defense/Stamina, 0-100), prese dall'infobox della pagina Fandom
// DEDICATA della parte (es. "Blade - DranSword", "Bit - Accel"), NON dalla pagina prodotto.
// Opzionale: molte parti non le hanno (ratchet quasi sempre vuoti, parti nuove/S2) → resta
// undefined e i consumatori degradano (niente radar). Vedi /scrape-parts-master.
export interface PartStats {
  atk: number;
  def: number;
  sta: number;
}

// Piatto/formato di gioco. Recuperabile dai placement WBO (Xtreme overseas vs Infinity, soprattutto
// tornei ufficiali JP); MetaBeys non lo espone → resta undefined ("unknown"). Esposto come
// filtro/badge in UI, NON usato nel calcolo dello score (vedi scoring.ts).
export type Stadium = 'xtreme' | 'infinity';

export interface Blade {
  id: string;
  name: string;
  nameWestern?: string;
  aliases?: string[];
  type: BladeType;
  line: 'bx' | 'ux';
  releaseSet?: string;
  stats?: PartStats;
}

export interface LockChip {
  id: string;
  name: string;
  nameWestern?: string;
  line: 'cx';
}

export interface MainBlade {
  id: string;
  name: string;
  nameWestern?: string;
  line: 'cx';
  stats?: PartStats;
}

export interface AssistBlade {
  id: string;
  name: string;
  nameWestern?: string;
  shortName: string;
  line: 'cx';
}

export interface OverBlade {
  id: string;
  name: string;
  nameWestern?: string;
  line: 'cx';
}

export interface Ratchet {
  id: string;
  name: string;
  sides: number;
  height: number;
  stats?: PartStats;
}

export interface Bit {
  id: string;
  name: string;
  type: BitType;
  shortName?: string;   // codice ufficiale stampato sui prodotti (es. "H" = Hexa, "FB" = Free Ball)
  aliases?: string[];
  stats?: PartStats;
}

export interface PartsRegistry {
  version: string;
  blades: Blade[];
  lockChips: LockChip[];
  mainBlades: MainBlade[];
  assistBlades: AssistBlade[];
  overBlades: OverBlade[];
  ratchets: Ratchet[];
  bits: Bit[];
}

export interface ComboSource {
  name: string;
  url: string;
  weight: number;
  date: string;
}

// Tier della fonte: structured = DB torneo parsabili deterministicamente (MetaBeys/WBO/Sheets);
// narrative = prosa (YouTube/Reddit/blog); theory = tier-list teoriche (BeyBase/BeyXDB).
export type SourceTier = 'structured' | 'narrative' | 'theory';

// Evidenza grezza persistita: alimenta il ricalcolo deterministico dello score E i badge in UI.
// placements/usage = risultati torneo; mentions = opinioni (pesano poco, vedi scoring.ts).
export interface PlacementEvidence {
  source: string;        // id fonte (sources.json), es. "metabeys"
  tier: SourceTier;
  eventId: string;
  eventName: string;
  date: string;          // yyyy-mm-dd
  placement: number;     // 1 = primo, 2 = secondo, ...
  topCutSize?: number;
  players?: number;      // dimensione evento (prestigio)
  deckScore?: string;    // S/A/B/C/D (MetaBeys)
  stadium?: Stadium;     // piatto del torneo (da WBO); undefined = sconosciuto
  lang: string;
  url?: string;
}

export interface UsageEvidence {
  source: string;        // es. "metabeys-leaderboard"
  date: string;          // data snapshot
  window: string;        // finestra, es. "30d"
  appearances?: number;
  sharePct?: number;
  uniqueEvents?: number;
  uniquePlayers?: number;
  lang?: string;
}

export interface MentionEvidence {
  source: string;
  date: string;
  kind: string;          // "recommendation" | "tier-list" | ...
  lang: string;
  url?: string;
}

export interface ComboEvidence {
  placements: PlacementEvidence[];
  usage: UsageEvidence[];
  mentions: MentionEvidence[];
}

// Breakdown del Competitive Authority Score (CAS): tre pilastri 0-1 + meta per i badge.
// Vedi docs/scoring-algorithm.md.
export interface ScoreBreakdown {
  performance: number;     // 0-1, piazzamenti pesati (vittorie/finali)
  presence: number;        // 0-1, usage/meta share + ampiezza
  corroboration: number;   // 0-1, fonti indipendenti distinte
  // Meta osservabile (per i badge "18 eventi, 4 vittorie")
  tournamentEvents: number;
  wins: number;
  topCutAppearances: number;
  metaSharePct?: number;
  lastPlacementDate?: string;   // data del placement più recente (freschezza), yyyy-mm-dd
  stadiums?: Stadium[];         // piatti distinti tra i placement (badge/filtro UI)
  usageTrend?: 'up' | 'down' | 'stable';  // trend meta-share da storico usage (≥2 snapshot)
}

export interface AmazonProduct {
  query: string;
  asin?: Record<string, string>;
}

export interface Combo {
  id: string;
  line: ComboLine;
  blade: string | null;
  ratchet: string;
  bit: string;
  lockChip: string | null;
  mainBlade: string | null;
  assistBlade: string | null;
  overBlade?: string | null;
  displayName: string;
  type: BladeType;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  evidence?: ComboEvidence;
  tags: string[];
  notes: string;
  sources: ComboSource[];
  amazon?: {
    blade?: AmazonProduct;
    fullSet?: AmazonProduct;
  };
  dateAdded: string;
  dateUpdated: string;
}

export interface CombosDatabase {
  lastUpdated: string;
  combos: Combo[];
}

export type Locale = 'en' | 'it';

export interface SelectedParts {
  blades: string[];
  lockChips: string[];
  mainBlades: string[];
  assistBlades: string[];
  overBlades: string[];
  ratchets: string[];
  bits: string[];
}
