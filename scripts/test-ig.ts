/**
 * test-ig.ts — golden test dei candidati Instagram (scripts/lib/ig-posts.ts) su un db sintetico.
 * Esegui: npx tsx scripts/test-ig.ts  (esce 1 se un assert fallisce).
 */
import { computeCandidates, isoWeek, daysBefore, type Combo } from './lib/ig-posts';
import { renderCaption, renderSlides } from './lib/ig-render';
import { partStats } from '../src/lib/top-cut';

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
  // CX: conta come le altre, con la Main Blade «m» come lama; 40 top cut nel mese → seconda combo e
  // seconda lama. In giro da un anno, così non diventa una lama nuova.
  { id: 'cx1', line: 'cx', blade: null, lockChip: 'lc', mainBlade: 'm', assistBlade: 'as', overBlade: 'ov', ratchet: '9-60', bit: 'kick', displayName: 'cx1', type: 'balance',
    evidence: { placements: [...Array.from({ length: 40 }, (_, i) => ({ date: day(1 + (i % 29)), placement: (i % 3) + 1, eventName: `cx${i}` })), { date: day(300), placement: 2, eventName: 'cxfirst' }] } },
  // CX senza Main Blade (combo incompleta): fuori da ogni classifica
  { id: 'cx-rotta', line: 'cx', blade: null, lockChip: 'lc', mainBlade: null, assistBlade: 'as', ratchet: '1-60', bit: 'hexa', displayName: 'cx-rotta', evidence: { placements: [{ date: day(2), placement: 1, eventName: 'x' }] } },
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
const cxBuild = (tb.data as any).combos[1];
check('top-build: la CX è seconda, con la Main Blade come lama e le sue parti', cxBuild?.name === 'cx1' && cxBuild.topCut === 40 && cxBuild.line === 'cx' && cxBuild.blade === 'm' && cxBuild.lockChip === 'lc' && cxBuild.overBlade === 'ov', JSON.stringify(cxBuild));
check('top-build: la CX senza Main Blade non compare', !(tb.data as any).combos.some((c: any) => c.name === 'cx-rotta'));
check('top-lame: prima a con 130, quota calcolata', (tl.data as any).blades[0].blade === 'a' && (tl.data as any).blades[0].topCut === 130 && Math.abs((tl.data as any).blades[0].share - 130 / (tl.data as any).totalTopCut) < 1e-9);
check('top-lame: la Main Blade m è seconda, marcata cx', (tl.data as any).blades[1]?.blade === 'm' && (tl.data as any).blades[1]?.line === 'cx', JSON.stringify((tl.data as any).blades[1]));
check('top-lame: il totale include la CX (a 130 + b 25 + e 30 + f 28 + g 26 + c 25 + d 20 + h 9 + cx 40)', (tl.data as any).totalTopCut === 333, `=${(tl.data as any).totalTopCut}`);
check('top-lame: 5 lame', (tl.data as any).blades.length === 5);

console.log('classifiche ratchet e bit (pagina /top-cut/)');
const ratchets = partStats(db, 'ratchet', day(30), day(0));
const bits = partStats(db, 'bit', day(30), day(0));
check('ratchet: il ratchet integrato (null) non conta', !ratchets.some((r) => r.part === 'null') && ratchets.reduce((a, r) => a + r.topCut, 0) === 333 - 25, `=${ratchets.reduce((a, r) => a + r.topCut, 0)}`);
check('ratchet: 1-60 primo con a 100 + d 8 (la CX rotta non conta)', ratchets[0].part === '1-60' && ratchets[0].topCut === 108, JSON.stringify(ratchets[0]));
check('bit: la CX conta (kick = a 30 + c 25 + cx 40)', bits.find((b) => b.part === 'kick')?.topCut === 95, JSON.stringify(bits.find((b) => b.part === 'kick')));
check('bit: quote che sommano a 1', Math.abs(bits.reduce((a, b) => a + b.share, 0) - 1) < 1e-9);

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
const cxSlides = renderSlides(ctx, tb).join('');
check('slide della CX: griglia con lock chip, main, assist, over, ratchet e bit', cxSlides.includes('class="cxgrid"') && ['LC', 'M', 'AS', 'OV', '9-60', 'KICK'].every((n) => cxSlides.includes(`<span class="nm">${n}</span>`)));
check('ratchet integrato reso a testo, non «null»', renderSlides(ctx, nuova[0]).join('').includes('integrato nella lama') && !renderSlides(ctx, nuova[0]).join('').includes('>null<'));

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
