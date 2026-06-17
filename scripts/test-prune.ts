/**
 * test-prune.ts — golden test della logica di pruning pura (scripts/prune-combos.ts).
 *
 * Valida la partizione tieni/orfane (con ref iniettato) e l'idempotenza. Non tocca i file.
 * Esegui: npx tsx scripts/test-prune.ts  (esce 1 se un assert fallisce).
 */
import { partition, freshEvidenceCount } from './prune-combos';
import type { Combo } from '../src/lib/types';

const REF = new Date('2026-06-15T00:00:00Z'); // cutoff = 2025-06-15
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}

const combo = (id: string, evidence: any): Combo => ({ id, evidence, score: 0, tags: [] } as unknown as Combo);

const A = combo('a-fresh-placement', { placements: [{ date: '2026-06-10', tier: 'structured', source: 'metabeys' }], usage: [], mentions: [] });
const B = combo('b-stale-placement', { placements: [{ date: '2025-01-01', tier: 'structured', source: 'metabeys' }], usage: [], mentions: [] });
const C = combo('c-fresh-mention', { placements: [], usage: [], mentions: [{ date: '2026-05-01', source: 'youtube' }] });
const D = combo('d-empty', { placements: [], usage: [], mentions: [] });
const E = combo('e-no-evidence', undefined);
const F = combo('f-stale-but-in-evidence', { placements: [{ date: '2024-01-01', tier: 'structured', source: 'metabeys' }], usage: [], mentions: [] });
const G = combo('g-boundary', { placements: [{ date: '2025-06-15', tier: 'structured', source: 'wbo' }], usage: [], mentions: [] });

const freshIds = new Set(['f-stale-but-in-evidence']); // F coperta da evidenza torneo fresca nelle fonti

console.log('freshEvidenceCount');
check('placement fresco conta', freshEvidenceCount(A.evidence, REF) === 1);
check('placement stantio non conta', freshEvidenceCount(B.evidence, REF) === 0);
check('mention fresca conta', freshEvidenceCount(C.evidence, REF) === 1);
check('evidenza assente = 0', freshEvidenceCount(E.evidence, REF) === 0);
check('confine (2025-06-15) è fresco', freshEvidenceCount(G.evidence, REF) === 1);

console.log('partition');
const { keep, orphans } = partition([A, B, C, D, E, F, G], freshIds, REF);
const ids = (cs: Combo[]) => cs.map((c) => c.id).sort();
check('tenute = A, C, F, G', JSON.stringify(ids(keep)) === JSON.stringify(['a-fresh-placement', 'c-fresh-mention', 'f-stale-but-in-evidence', 'g-boundary']), JSON.stringify(ids(keep)));
check('orfane = B, D, E', JSON.stringify(ids(orphans)) === JSON.stringify(['b-stale-placement', 'd-empty', 'e-no-evidence']), JSON.stringify(ids(orphans)));

console.log('idempotenza');
const again = partition(keep, freshIds, REF);
check('ri-partizionare le tenute non produce orfane', again.orphans.length === 0, `=${again.orphans.length}`);
check('le tenute restano invariate', again.keep.length === keep.length);

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
