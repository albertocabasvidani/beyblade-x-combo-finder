// Beyblade X part types

export type BladeType = 'attack' | 'defense' | 'stamina' | 'balance';
export type BitType = 'attack' | 'defense' | 'stamina' | 'balance';
export type ComboLine = 'bx' | 'cx';
export type NameVariant = 'western' | 'eastern';

export interface Blade {
  id: string;
  name: string;
  nameWestern?: string;
  type: BladeType;
  line: 'bx';
  releaseSet?: string;
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
}

export interface AssistBlade {
  id: string;
  name: string;
  nameWestern?: string;
  shortName: string;
  line: 'cx';
}

export interface Ratchet {
  id: string;
  name: string;
  sides: number;
  height: number;
}

export interface Bit {
  id: string;
  name: string;
  type: BitType;
}

export interface PartsRegistry {
  version: string;
  blades: Blade[];
  lockChips: LockChip[];
  mainBlades: MainBlade[];
  assistBlades: AssistBlade[];
  ratchets: Ratchet[];
  bits: Bit[];
}

export interface ComboSource {
  name: string;
  url: string;
  weight: number;
  date: string;
}

export interface ScoreBreakdown {
  sourceReliability: number;
  frequency: number;
  recency: number;
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
  displayName: string;
  type: BladeType;
  score: number;
  scoreBreakdown: ScoreBreakdown;
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
  ratchets: string[];
  bits: string[];
}
