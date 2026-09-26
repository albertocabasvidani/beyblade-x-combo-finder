/**
 * test-ig.ts — golden test dei candidati Instagram (scripts/lib/ig-posts.ts) su un db sintetico.
 * Esegui: npx tsx scripts/test-ig.ts  (esce 1 se un assert fallisce).
 */
import { computeCandidates, isoWeek, daysBefore, type Combo } from './lib/ig-posts';
import { renderCaption, renderSlides } from './lib/ig-render';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}

const REF = new Date('2026-09-26T00:00:00Z');
const day = (n: number) => daysBefore(REF, n);
let seq = 0;
/** Combo con `recent` piazzamenti negli ultimi 30 giorni e `older` fra 31 e 90 giorni fa. */
function combo(blade: string, ratchet: string | null, bit: string, recent: number, older: number, firstDaysAgo?: number): Combo {
  const placements = [];
  for (let i = 0; i < recent; i++) placements.push({ date: day(1 + (i % 29)), placement: (i % 3) + 1, eventName: `ev${seq++}` });
  for (let i = 0; i < older; i++) placements.push({ date: day(31 + (i % 59)), placement: (i % 3) + 1, eventName: `ev${seq++}` });
  if (firstDaysAgo != null) placements.push({ date: day(firstDaysAgo), placement: 3, eventName: 'first' });
  const id = `${blade}-${ratchet ?? 'x'}-${bit}`;
  return { id, line: 'bx', blade, ratchet, bit, displayName: id, type: 'attack', evidence: { placements } };
}

const db: Combo[] = [
  // A: dominante (top 5 sicura), in giro da un anno
  combo('a', '1-60', 'hexa', 100, 200, 300), combo('a', '3-60', 'kick', 30, 60),
  // B, E, F, G: lame di mezzo per riempire la top 5 (in giro da un anno)
  combo('b', '1-70', 'lr', 25, 50, 300), combo('e', '9-60', 'fb', 30, 60, 300), combo('f', '5-60', 'el', 28, 56, 300), combo('g', '4-60', 'p', 26, 52, 300),
  // C: lama NUOVA (prima evidenza 40 giorni fa) con 45 piazzamenti → build-lama-nuova
  combo('c', null, 'kick', 25, 19, 40),
  // D: vecchia lama (in giro da 200 giorni), 20 recenti contro 4 nei due mesi prima → nuovo ingresso ×10
  combo('d', '3-60', 'rush', 12, 2, 200), combo('d', '1-60', 'hexa', 8, 2),
  // H: vecchia lama in crescita ma sotto la soglia dei 15 → no
  combo('h', '3-60', 'rush', 9, 1, 200),
  // CX: ignorata
  { id: 'cx1', line: 'cx', blade: 'z', ratchet: '1-60', bit: 'hexa', displayName: 'cx1', evidence: { placements: [{ date: day(2), placement: 1 }] } },
];

const cands = computeCandidates(db, REF);
const byType = (t: string) => cands.filter((c) => c.type === t);

console.log('isoWeek');
check('26/09/2026 (sabato) → 2026-W39', isoWeek(REF) === '2026-W39', `=${isoWeek(REF)}`);
check('28/09/2026 (lunedì) → 2026-W40', isoWeek(new Date('2026-09-28T00:00:00Z')) === '2026-W40');
check('01/01/2027 (venerdì) → 2026-W53', isoWeek(new Date('2027-01-01T00:00:00Z')) === '2026-W53', `=${isoWeek(new Date('2027-01-01T00:00:00Z'))}`);

console.log('settimanali');
const tb = byType('top-build')[0], tl = byType('top-lame')[0];
check('top-build con id della settimana', tb?.id === 'top-build-2026-W39', `=${tb?.id}`);
check('generato di domenica 27/09 → settimana del lunedì (W40)', computeCandidates(db, new Date('2026-09-27T04:00:00Z')).find((c) => c.type === 'top-build')?.id === 'top-build-2026-W40');
check('top-build: 5 combo, prima a-1-60-hexa con 100', (tb.data as any).combos.length === 5 && (tb.data as any).combos[0].name === 'a-1-60-hexa' && (tb.data as any).combos[0].topCut === 100);
check('top-build: la CX non compare', !(tb.data as any).combos.some((c: any) => c.name === 'cx1'));
check('top-lame: prima a con 130, quota calcolata', (tl.data as any).blades[0].blade === 'a' && (tl.data as any).blades[0].topCut === 130 && Math.abs((tl.data as any).blades[0].share - 130 / (tl.data as any).totalTopCut) < 1e-9);
check('top-lame: 5 lame', (tl.data as any).blades.length === 5);

console.log('eventi');
const nuova = byType('build-lama-nuova');
check('lama nuova C pronta (45 piazzamenti, prima evidenza 40 giorni fa)', nuova.length === 1 && nuova[0].blade === 'c', `=${nuova.map((c) => c.blade)}`);
check('lama nuova: le build hanno il ratchet integrato (null)', (nuova[0].data as any).builds[0].ratchet === null);
const rising = byType('nuovo-ingresso');
check('nuovo ingresso: solo D', rising.length === 1 && rising[0].blade === 'd', `=${rising.map((c) => c.blade)}`);
check('nuovo ingresso: 20 recenti, 2 al mese prima, crescita ×10', (rising[0].data as any).recent === 20 && (rising[0].data as any).prevMonthly === 2 && (rising[0].data as any).growth === 10, JSON.stringify({ r: (rising[0].data as any).recent, p: (rising[0].data as any).prevMonthly, g: (rising[0].data as any).growth }));
check('nuovo ingresso: A esclusa perché in top 5, H sotto soglia, C perché nuova', !rising.some((c) => ['a', 'h', 'c'].includes(c.blade!)));
check('precedenza: lama nuova prima del nuovo ingresso', nuova[0].priority < rising[0].priority);

console.log('riempitivi');
const fill = byType('build-lama');
check('una per lama della top 10 a 90 giorni, in ordine', fill.length >= 8 && fill[0].blade === 'a' && fill[0].id === 'build-lama-a');
check('al massimo 4 build per lama', fill.every((c) => (c.data as any).builds.length <= 4));

console.log('render');
const ctx = { name: (id: string) => id.toUpperCase(), img: () => '', asOf: '26/09/2026' };
for (const c of [tb, tl, nuova[0], rising[0], fill[0]]) {
  const slides = renderSlides(ctx, c);
  check(`${c.type}: slide 3-7, tutte HTML complete`, slides.length >= 3 && slides.length <= 7 && slides.every((s) => s.startsWith('<!doctype html>') && s.includes('</html>')), `=${slides.length}`);
  const cap = renderCaption(ctx, c);
  check(`${c.type}: didascalia con sito e hashtag, entro 2200`, cap.includes('beybladexcombos.com') && cap.includes('#beybladex') && cap.length <= 2200);
}
check('ratchet integrato reso a testo, non «null»', renderSlides(ctx, nuova[0]).join('').includes('integrato nella lama') && !renderSlides(ctx, nuova[0]).join('').includes('>null<'));

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
