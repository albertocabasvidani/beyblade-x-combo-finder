/**
 * slim-combos.ts — proiezione di combos.json per il client.
 *
 * Il sito riceve solo i campi che la UI legge davvero: niente `evidence` (migliaia di placement per
 * combo), niente `sources[]` (basta il conteggio). Il dataset intero passava come prop dell'isola
 * Preact e Astro lo serializzava in un attributo HTML (ogni virgoletta → `&quot;`): 19 MB di JSON
 * diventavano una home da 38,5 MB (misurato l'11/09/2026). Il dataset ridotto viene servito come
 * asset separato (`/combos.json`, ~190 KB gzip) e fetchato dall'isola, che parte con le prime
 * combo inline.
 */
import type {
  Combo, ComboLine, CombosDatabase, ComboWindow, ComboWindows, TierThresholds, WindowKey,
} from './types';
import { TIER_ABS, WINDOW_KEYS } from './scoring';

export interface SlimCombo {
  id: string;
  line: ComboLine;
  displayName: string;
  blade: string | null;
  ratchet: string | null;
  bit: string;
  lockChip: string | null;
  mainBlade: string | null;
  assistBlade: string | null;
  overBlade: string | null;
  notes?: string;
  sourceCount: number;
  /** Score/breakdown/tag per finestra 30/90/180/365 giorni; "365" è sempre presente (== score della combo). */
  windows: ComboWindows;
}

export interface SlimDatabase {
  lastUpdated: string;
  thresholds: Record<WindowKey, TierThresholds>;
  /** Ordinate per windows["365"].score decrescente. */
  combos: SlimCombo[];
}

/**
 * Combo inline nella home (primo paint senza attendere il fetch del dataset). Ogni combo inline costa
 * ~3,5 KB di HTML (props serializzate con &quot;): 30 combo + registro parti + traduzioni ≈ 330 KB,
 * ~30 KB compressi sulla rete.
 */
export const INITIAL_COMBOS = 30;

/**
 * Finestre della combo. Se combos.json non è ancora stato riscorato dal nuovo score:combos (nessun
 * `windows`), sintetizza la sola finestra 365 da score/scoreBreakdown/tags, così il sito resta
 * funzionante anche con un dato vecchio.
 */
function windowsOf(c: Combo): ComboWindows {
  if (c.windows && c.windows['365']) return c.windows;
  const b = c.scoreBreakdown;
  if (!b || (b.tournamentEvents === 0 && b.topCutAppearances === 0 && b.metaSharePct == null)) return {};
  const w365: ComboWindow = { ...b, score: c.score, tags: c.tags ?? [] };
  return { '365': w365 };
}

export function toSlim(db: CombosDatabase): SlimDatabase {
  const combos: SlimCombo[] = [];
  for (const c of db.combos) {
    const windows = windowsOf(c);
    if (!windows['365']) continue;                // nessun risultato in 365 giorni → fuori dal sito
    const s: SlimCombo = {
      id: c.id, line: c.line, displayName: c.displayName,
      blade: c.blade, ratchet: c.ratchet, bit: c.bit,
      lockChip: c.lockChip, mainBlade: c.mainBlade, assistBlade: c.assistBlade, overBlade: c.overBlade ?? null,
      sourceCount: (c.sources ?? []).length,
      windows,
    };
    if (c.notes) s.notes = c.notes;
    combos.push(s);
  }
  combos.sort((a, b) => b.windows['365']!.score - a.windows['365']!.score);
  // Le soglie scritte nel file prevalgono, il ripiego copre le chiavi che mancano: un combos.json con
  // chiavi di finestra diverse da quelle del codice non deve lasciare una finestra senza soglie
  // (scoreTier andrebbe in errore su `th.meta`).
  const fallback = Object.fromEntries(WINDOW_KEYS.map((k) => [k, { ...TIER_ABS }])) as Record<WindowKey, TierThresholds>;
  return { lastUpdated: db.lastUpdated, thresholds: { ...fallback, ...db.windowThresholds }, combos };
}
