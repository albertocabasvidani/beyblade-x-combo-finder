/**
 * prune-combos.ts — Pruning DETERMINISTICO del database combo per cutoff temporale (12 mesi).
 *
 * Confine IA/codice: il pruning è deterministico → codice, niente IA. Politica:
 *  - Una combo è "orfana" se non ha alcuna evidenza fresca (placements/usage/mentions entro il cutoff,
 *    src/lib/freshness) e nessuna fonte torneo fresca la copre. Le orfane vengono ARCHIVIATE in
 *    data/combos-archive.json (reversibile, niente perdita di note/tag manuali) e tolte da combos.json.
 *  - Le combo tenute NON vengono toccate (lo scoring, che gira prima, ha già filtrato l'evidenza per
 *    freschezza e calcolato i breakdown: prune = solo rimozione/archivio, non ricalcolo).
 *  - Riconciliazione: gli id tornati attivi vengono tolti dall'archivio (self-healing col re-score).
 *
 * Guardrail (stile build-parts.ts): default DRY-RUN (nessuna scrittura, solo report). `--apply` scrive.
 * Abort se l'evidenza torneo è a zero (upstream rotto) o se le orfane superano PRUNE_GUARD_PCT del DB.
 *
 * Esegui: npx tsx scripts/prune-combos.ts            (dry-run)
 *         npx tsx scripts/prune-combos.ts --apply     (applica)
 * Env: PRUNE_GUARD_PCT (default 60), COMBO_CUTOFF_MONTHS (default 12).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { isFresh, CUTOFF_MONTHS } from './lib/freshness';
import type { Combo, CombosDatabase, ComboEvidence } from '../src/lib/types';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const combosPath = join(DATA, 'combos.json');
const archivePath = join(DATA, 'combos-archive.json');
const metabeysPath = join(DATA, 'metabeys-evidence.json');
const wboPath = join(DATA, 'wbo-evidence.json');

const APPLY = process.argv.includes('--apply');
const GUARD_PCT = Math.min(100, Math.max(1, parseInt(process.env.PRUNE_GUARD_PCT ?? '60', 10) || 60));
const today = () => new Date().toISOString().slice(0, 10);

/** Numero di voci di evidenza fresche (placements + usage + mentions) di una combo. */
export function freshEvidenceCount(ev: ComboEvidence | undefined, ref: Date): number {
  if (!ev) return 0;
  const f = <T extends { date: string }>(a?: T[]) => (a ?? []).filter((x) => isFresh(x.date, ref)).length;
  return f(ev.placements) + f(ev.usage) + f(ev.mentions);
}

/**
 * Partiziona le combo in tenute / orfane (pura, ref iniettabile per i test). `freshIds` = id coperti da
 * evidenza torneo fresca nelle fonti (rete di sicurezza se lo scoring non è girato prima del prune).
 */
export function partition(combos: Combo[], freshIds: Set<string>, ref: Date): { keep: Combo[]; orphans: Combo[] } {
  const keep: Combo[] = [];
  const orphans: Combo[] = [];
  for (const c of combos) {
    const hasFresh = freshEvidenceCount(c.evidence, ref) > 0 || freshIds.has(c.id);
    (hasFresh ? keep : orphans).push(c);
  }
  return { keep, orphans };
}

function structuredPlacements(ev: any): number {
  return Object.values(ev.combos ?? {}).reduce((n: number, c: any) => n + (c.placements?.length ?? 0), 0);
}

function main() {
  if (!existsSync(combosPath)) { console.error('combos.json mancante.'); process.exit(1); }
  const db: CombosDatabase = JSON.parse(readFileSync(combosPath, 'utf8'));
  const mb = existsSync(metabeysPath) ? JSON.parse(readFileSync(metabeysPath, 'utf8')) : { combos: {} };
  const wbo = existsSync(wboPath) ? JSON.parse(readFileSync(wboPath, 'utf8')) : { combos: {} };
  const ref = new Date();

  // Guardrail PRE: evidenza torneo a zero ⇒ fetch/parse rotto, non meta vuoto davvero. Non potare.
  if (structuredPlacements(mb) + structuredPlacements(wbo) === 0) {
    console.error('GUARDRAIL: evidenza torneo (metabeys+wbo) a 0 piazzamenti — probabile fetch/parse rotto. Niente pruning.');
    process.exit(1);
  }

  // id coperti da evidenza torneo fresca (rete di sicurezza per uso standalone).
  const freshIds = new Set<string>();
  for (const src of [mb, wbo]) {
    for (const [id, c] of Object.entries<any>(src.combos ?? {})) {
      if ((c.placements ?? []).some((p: any) => isFresh(p.date, ref))) freshIds.add(id);
    }
  }

  const { keep, orphans } = partition(db.combos, freshIds, ref);

  console.log(`Pruning (cutoff ${CUTOFF_MONTHS} mesi, ref ${today()}):`);
  console.log(`  combo totali:           ${db.combos.length}`);
  console.log(`  da tenere:              ${keep.length}`);
  console.log(`  orfane (da archiviare): ${orphans.length}`);
  for (const o of orphans.slice(0, 30)) console.log(`    - ${o.id}  (score ${o.score}, tag ${JSON.stringify(o.tags)})`);
  if (orphans.length > 30) console.log(`    … e altre ${orphans.length - 30}`);

  // Guardrail soglia: protezione contro cutoff mal configurato / evidenza svuotata.
  const pct = db.combos.length ? (orphans.length / db.combos.length) * 100 : 0;
  if (pct > GUARD_PCT) {
    console.error(`\nGUARDRAIL: archivierebbe ${orphans.length}/${db.combos.length} combo (${pct.toFixed(0)}% > ${GUARD_PCT}%). combos.json NON modificato. Verifica cutoff/evidenze.`);
    process.exit(1);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN: nessuna scrittura. Rilancia con --apply per archiviare le orfane.`);
    return;
  }

  // Archivio: merge orfane (dedup per id) + riconcilia (togli gli id tornati attivi).
  const archive = existsSync(archivePath) ? JSON.parse(readFileSync(archivePath, 'utf8')) : { combos: [] };
  const activeIds = new Set(keep.map((c) => c.id));
  const archMap = new Map<string, any>();
  for (const c of archive.combos ?? []) if (!activeIds.has(c.id)) archMap.set(c.id, c); // riconciliazione
  for (const o of orphans) archMap.set(o.id, { ...o, archivedReason: `no-fresh-evidence (cutoff ${CUTOFF_MONTHS}m)`, archivedDate: today() });
  const archCombos = [...archMap.values()].sort((a, b) => a.id.localeCompare(b.id));

  db.combos = keep;
  db.lastUpdated = new Date().toISOString();
  writeFileSync(combosPath, JSON.stringify(db, null, 2) + '\n');
  writeFileSync(archivePath, JSON.stringify({ lastUpdated: new Date().toISOString(), combos: archCombos }, null, 2) + '\n');
  console.log(`\n--apply: ${orphans.length} archiviate, ${keep.length} attive. Archivio: ${archCombos.length} combo → ${archivePath}`);
}

// Esegui solo come entry-point: l'import dal golden test NON deve innescare main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
