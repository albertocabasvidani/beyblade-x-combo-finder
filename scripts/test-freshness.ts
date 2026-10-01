/**
 * test-freshness.ts — golden test del cutoff condiviso (scripts/lib/freshness.ts).
 *
 * Valida il confine di freschezza (con ref iniettato) e il parsing delle date lunghe MetaBeys.
 * Esegui: npx tsx scripts/test-freshness.ts  (esce 1 se un assert fallisce).
 */
import { CUTOFF_DAYS, cutoffISO, isFresh, parseLongDate } from './lib/freshness';

const REF = new Date('2026-06-15T00:00:00Z');
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}

console.log('CUTOFF_DAYS / cutoffISO');
check('default 365 giorni', CUTOFF_DAYS === 365, `=${CUTOFF_DAYS}`);
check('confine = ref − 365 giorni', cutoffISO(REF) === '2025-06-15', `=${cutoffISO(REF)}`);
check('anno bisestile in mezzo: 365 giorni, non 12 mesi (2028-06-15 → 2027-06-16)',
  cutoffISO(new Date('2028-06-15T12:00:00Z')) === '2027-06-16', `=${cutoffISO(new Date('2028-06-15T12:00:00Z'))}`);
check('fine mese: niente traboccamento (2026-03-31 → 2025-03-31)',
  cutoffISO(new Date('2026-03-31T00:00:00Z')) === '2025-03-31', `=${cutoffISO(new Date('2026-03-31T00:00:00Z'))}`);
check('orario del ref ignorato (23:59 UTC → stesso confine)',
  cutoffISO(new Date('2026-06-15T23:59:59Z')) === '2025-06-15');

console.log('isFresh — confine (ref 2026-06-15 → cutoff 2025-06-15)');
check('data esattamente sul confine è fresca', isFresh('2025-06-15', REF));
check('un giorno prima del confine NON è fresca', !isFresh('2025-06-14', REF));
check('data recente è fresca', isFresh('2026-06-10', REF));
check('data molto vecchia NON è fresca', !isFresh('2024-12-31', REF));
check('data futura è fresca', isFresh('2026-12-01', REF));
check('data vuota → fresca (non si scarta età ignota)', isFresh('', REF));
check('data null → fresca', isFresh(null, REF));

console.log('parseLongDate');
check('con giorno della settimana', parseLongDate('Saturday, June 13, 2026') === '2026-06-13', `=${parseLongDate('Saturday, June 13, 2026')}`);
check('senza giorno della settimana', parseLongDate('June 13, 2026') === '2026-06-13');
check('dentro testo più lungo', parseLongDate('... • 13:00 – 16:00 • December 1, 2025 • ...') === '2025-12-01', `=${parseLongDate('... • 13:00 – 16:00 • December 1, 2025 • ...')}`);
check('giorno a una cifra zero-padded', parseLongDate('May 5, 2026') === '2026-05-05', `=${parseLongDate('May 5, 2026')}`);
check('nessuna data → null', parseLongDate('Top Cut Entrants — no date here') === null);

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
