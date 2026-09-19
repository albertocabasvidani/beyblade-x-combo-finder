/**
 * build-data.ts — indici sui dati grezzi (data/combos.json, parts-master.json, releases.json)
 * per le pagine editoriali statiche. SOLO lato build: nessuna pagina che importa questo modulo
 * deve avere `client:*`, e nessun file sotto src/components/**\/*.tsx deve importarlo (verificato
 * da scripts/test-content.ts) — altrimenti Vite lo segue nel bundle client, che è l'esatto guasto
 * che slim-combos.ts esiste per evitare sulla home (19 MB in un attributo HTML).
 *
 * Gli indici sono costruiti una volta a module scope: Vite condivide l'istanza del modulo fra tutte
 * le pagine di una build, quindi 30+ pagine parte non ripetono la scansione di 4.925 combo ciascuna.
 */
import combosData from '../../data/combos.json';
import partsMasterData from '../../data/parts-master.json';
import releasesData from '../../data/releases.json';
import type { Combo, CombosDatabase, PlacementEvidence } from './types';

const db = combosData as unknown as CombosDatabase;
const releases = releasesData as {
  products: Array<{
    code: string;
    manufacturer: string;
    name: string;
    type: string;
    bladeNames?: string[];
    ratchet?: string;
    bitShort?: string;
    date?: string;
    listino?: { amount: number; currency: string };
    listinoEur?: number;
  }>;
};

/** Tutte le combo, indicizzate per id. */
export const comboById = new Map<string, Combo>(db.combos.map((c) => [c.id, c]));

/** Combo per parte, categoria per categoria (blade/ratchet/bit), ordinate per score decrescente. */
function buildCombosByPart(category: 'blade' | 'ratchet' | 'bit'): Map<string, Combo[]> {
  const map = new Map<string, Combo[]>();
  for (const c of db.combos) {
    const id = c[category];
    if (!id) continue;
    const arr = map.get(id) ?? [];
    arr.push(c);
    map.set(id, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.score - a.score);
  return map;
}
export const combosByBlade = buildCombosByPart('blade');
export const combosByRatchet = buildCombosByPart('ratchet');
export const combosByBit = buildCombosByPart('bit');

/** Placement aggregati per parte (categoria + id): eventi totali, vittorie, combo distinte. */
export interface PartAggregate {
  events: number;
  wins: number;
  combos: number;
  placements: PlacementEvidence[];
}
function buildPlacementsByPart(category: 'blade' | 'ratchet' | 'bit'): Map<string, PartAggregate> {
  const map = new Map<string, PartAggregate>();
  for (const c of db.combos) {
    const id = c[category];
    if (!id) continue;
    const agg = map.get(id) ?? { events: 0, wins: 0, combos: 0, placements: [] };
    agg.events += c.scoreBreakdown?.tournamentEvents ?? 0;
    agg.wins += c.scoreBreakdown?.wins ?? 0;
    agg.combos += 1;
    agg.placements.push(...(c.evidence?.placements ?? []));
    map.set(id, agg);
  }
  return map;
}
export const placementsByBlade = buildPlacementsByPart('blade');
export const placementsByRatchet = buildPlacementsByPart('ratchet');
export const placementsByBit = buildPlacementsByPart('bit');

/** Parte per categoria e id (nome TT/Hasbro, produttore, set d'uscita, stats). */
export const partMasterById = new Map<string, any>();
for (const [key, cat] of [
  ['blades', 'blade'],
  ['ratchets', 'ratchet'],
  ['bits', 'bit'],
  ['lockChips', 'lockChip'],
  ['mainBlades', 'mainBlade'],
  ['assistBlades', 'assistBlade'],
  ['overBlades', 'overBlade'],
] as const) {
  for (const p of (partsMasterData as any)[key] ?? []) {
    partMasterById.set(`${cat}:${p.id}`, p);
  }
}

/** Prodotto per codice set (releases.json), con date e listino. */
export const releaseByCode = new Map<string, (typeof releases.products)[number][]>();
for (const p of releases.products) {
  const arr = releaseByCode.get(p.code) ?? [];
  arr.push(p);
  releaseByCode.set(p.code, arr);
}

/** Tutti i placement (22.275 record) raggruppati per mese YYYY-MM, per i report mensili. */
export const placementsByMonth = new Map<string, PlacementEvidence[]>();
for (const c of db.combos) {
  for (const p of c.evidence?.placements ?? []) {
    const month = (p.date ?? '').slice(0, 7);
    if (!month) continue;
    const arr = placementsByMonth.get(month) ?? [];
    arr.push(p);
    placementsByMonth.set(month, arr);
  }
}

/** true se esiste una entry combo/parte/set nei dati grezzi con quell'id — usato per non linkare a vuoto. */
export function comboExists(id: string): boolean {
  return comboById.has(id);
}
export function partExists(category: string, id: string): boolean {
  return partMasterById.has(`${category}:${id}`);
}
export function setExists(code: string): boolean {
  return releaseByCode.has(code);
}
