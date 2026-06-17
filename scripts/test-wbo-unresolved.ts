/**
 * test-wbo-unresolved.ts — Golden test del ledger degli unresolved WBO. Verifica: idempotenza (stesso
 * input due volte → 0 nuovi, file stabile), preservazione dello `status` impostato a mano, aggregazione
 * delle occorrenze, categorizzazione deterministica e filtro isLedgerable.
 *
 * Esegui: npx tsx scripts/test-wbo-unresolved.ts
 */
import { mergeUnresolved, categorize, isLedgerable, keyOf, normLineOf, type Ledger } from './lib/wbo-unresolved';
import type { UnresolvedItem } from './lib/wbo-parse';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) pass++; else { fail++; console.error(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
};

const empty = (): Ledger => ({ generatedAt: '', source: 'wbo-winning-combos', items: [], stats: { total: 0, new: 0, triaged: 0, ignored: 0 } });

const items: UnresolvedItem[] = [
  { line: 'SliverWolf 9-60 Hexa', reason: 'blade non risolto: "SliverWolf" (CX o nome ignoto)', ctx: 'wbo-thread-1 1°' },
  { line: 'SliverWolf 9-60 Hexa', reason: 'blade non risolto: "SliverWolf" (CX o nome ignoto)', ctx: 'wbo-thread-2 2°' }, // ripetizione
  { line: 'WhaleWave 7-60?', reason: 'bit/sigla non risolto: "?"', ctx: 'wbo-thread-3 2°' },
  { line: 'Some Event', reason: 'oltre-cutoff (2024-01-01)', ctx: 'wbo-thread-4' },           // NON ledgerabile
  { line: 'Another Event', reason: 'nessun marcatore di piazzamento (deck list senza podio)' }, // NON ledgerabile
];

// 1) primo merge: 2 item ledgerabili distinti, entrambi nuovi
const r1 = mergeUnresolved(empty(), items, '2026-06-17');
check('primo merge: 2 item totali', r1.ledger.stats.total === 2, String(r1.ledger.stats.total));
check('primo merge: 2 nuovi', r1.added === 2, String(r1.added));
check('aggrega le ripetizioni (occurrences=2)',
  r1.ledger.items.find((i) => i.line.startsWith('SliverWolf'))?.occurrences === 2);
check('esclude oltre-cutoff e nessun-marcatore', r1.ledger.items.every((i) => !/oltre-cutoff|nessun marcatore/.test(i.reason)));
check('categoria missing-data per "?"', r1.ledger.items.find((i) => i.line.includes('?'))?.category === 'missing-data');

// 2) secondo merge identico: 0 nuovi, totale stabile
const r2 = mergeUnresolved(r1.ledger, items, '2026-06-18');
check('secondo merge: 0 nuovi (idempotente)', r2.added === 0, String(r2.added));
check('secondo merge: totale invariato', r2.ledger.stats.total === 2);

// 3) preservazione status impostato a mano
r2.ledger.items[0].status = 'ignored';
const r3 = mergeUnresolved(r2.ledger, items, '2026-06-19');
check('status "ignored" preservato dopo re-merge', r3.ledger.items[0].status === 'ignored');
check('stats riflette lo status', r3.ledger.stats.ignored === 1);

// 4) categorize + isLedgerable diretti
check('categorize CX ambiguo', categorize('HellsArc Foo', 'blade CX ambiguo: "..." (split multiplo)') === 'cx-ambiguous');
check('categorize blade-unresolved', categorize('SliverWolf', 'blade non risolto: "SliverWolf" (CX o nome ignoto)') === 'blade-unresolved');
check('categorize no-ratchet', categorize('BulletGriffon', 'bey a ratchet integrato (Bullet Griffon, fuori scope combo a 3 parti)') === 'no-ratchet' ||
  categorize('x', 'nessun ratchet (...)') === 'no-ratchet');
check('isLedgerable false per oltre-cutoff', isLedgerable('oltre-cutoff (2024-01-01)') === false);
check('isLedgerable true per blade non risolto', isLedgerable('blade non risolto: "x"') === true);

// 5) chiave stabile su forma normalizzata
check('keyOf stabile su normLine', keyOf(normLineOf('SliverWolf  9-60  Hexa')) === keyOf(normLineOf('sliverwolf 9-60 hexa')));

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
