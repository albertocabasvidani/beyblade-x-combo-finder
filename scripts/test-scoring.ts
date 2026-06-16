/**
 * test-scoring.ts — golden test dell'algoritmo CAS (src/lib/scoring.ts).
 *
 * Valida PROPRIETÀ dell'algoritmo (ordinamento, monotonicità, range, tag, decadimento),
 * non valori esatti: i numeri assoluti dipendono dalla taratura delle costanti.
 * Esegui: npx tsx scripts/test-scoring.ts  (esce 1 se un assert fallisce).
 */
import { scoreCombo, sat, decay, usageTrend, CONST } from '../src/lib/scoring';
import type { ComboEvidence, PlacementEvidence } from '../src/lib/types';

const REF = new Date('2026-06-15T00:00:00Z');
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}

// Helper: genera N placement strutturati su eventi distinti, recenti.
function placements(n: number, place: number, players: number, daysAgo = 5): PlacementEvidence[] {
  const d = new Date(REF.getTime() - daysAgo * 86_400_000);
  const date = d.toISOString().slice(0, 10);
  return Array.from({ length: n }, (_, i) => ({
    source: 'metabeys', tier: 'structured', eventId: `e${place}-${i}`,
    eventName: `Event ${i}`, date, placement: place, players, lang: 'en',
  }));
}

function ev(p: PlacementEvidence[], usage: ComboEvidence['usage'] = [], mentions: ComboEvidence['mentions'] = []): ComboEvidence {
  return { placements: p, usage, mentions };
}

console.log('sat() — mappa saturante');
check('sat(0,6)=0', sat(0, 6) === 0);
check('sat(6,6)=0.5', Math.abs(sat(6, 6) - 0.5) < 1e-9);
check('sat monotona crescente', sat(3, 6) < sat(12, 6));
check('sat < 1 sempre', sat(1e6, 6) < 1);

console.log('decay() — emivita');
check('decay oggi = 1', Math.abs(decay('2026-06-15', REF) - 1) < 1e-9);
check(`decay a ${CONST.HALF_LIFE_DAYS}g = 0.5`, Math.abs(decay(new Date(REF.getTime() - CONST.HALF_LIFE_DAYS * 86_400_000).toISOString().slice(0, 10), REF) - 0.5) < 1e-6);

console.log('Casi combo');
// Dominante: tanti piazzamenti alti, eventi medi, + usage leaderboard forte
const dominant = scoreCombo(ev(
  [...placements(40, 1, 25), ...placements(35, 2, 25), ...placements(30, 3, 25)],
  [{ source: 'metabeys-leaderboard', date: '2026-06-15', window: '30d', appearances: 731, sharePct: 14, uniqueEvents: 228, uniquePlayers: 335 }],
  [{ source: 'youtube-beymac', date: '2026-06-01', kind: 'recommendation', lang: 'en' }],
), { ref: REF });

// Medio: poca usage, pochi piazzamenti
const mid = scoreCombo(ev(
  [...placements(2, 2, 20), ...placements(3, 3, 20)],
  [{ source: 'metabeys-leaderboard', date: '2026-06-15', window: '30d', appearances: 19, sharePct: 0.35, uniqueEvents: 17, uniquePlayers: 13 }],
), { ref: REF });

// Fringe: una sola vittoria locale, nessuna usage
const fringe = scoreCombo(ev(placements(1, 1, 33)), { ref: REF });

// Theory-only: solo menzioni (tier-list), nessun risultato
const theory = scoreCombo(ev([], [], [
  { source: 'beybase', date: '2026-02-01', kind: 'tier-list', lang: 'en' },
]), { ref: REF });

console.log(`  [debug] dominant=${dominant.score} mid=${mid.score} fringe=${fringe.score} theory=${theory.score}`);
console.log(`  [debug] dominant breakdown`, dominant.breakdown);

check('dominant alto (≥8.5, soglia "meta")', dominant.score >= 8.5, `=${dominant.score}`);
check('ordinamento dominant>mid>fringe>theory', dominant.score > mid.score && mid.score > fringe.score && fringe.score > theory.score,
  `(${dominant.score},${mid.score},${fringe.score},${theory.score})`);
check('mid in range plausibile (2-7)', mid.score >= 2 && mid.score <= 7, `=${mid.score}`);
check('fringe basso (<4)', fringe.score < 4, `=${fringe.score}`);
check('theory molto basso (<2)', theory.score < 2, `=${theory.score}`);

console.log('Tag');
check('dominant ha "meta"', dominant.tags.includes('meta'), JSON.stringify(dominant.tags));
check('dominant ha "tournament-proven"', dominant.tags.includes('tournament-proven'));
check('theory ha "theory-only"', theory.tags.includes('theory-only'), JSON.stringify(theory.tags));
check('fringe NON ha "meta"', !fringe.tags.includes('meta'));

console.log('Monotonicità');
const fewWins = scoreCombo(ev(placements(5, 1, 25)), { ref: REF }).score;
const manyWins = scoreCombo(ev(placements(20, 1, 25)), { ref: REF }).score;
check('più vittorie ⇒ score maggiore', manyWins > fewWins, `(${fewWins} vs ${manyWins})`);
const smallEvent = scoreCombo(ev(placements(5, 1, 8)), { ref: REF }).score;
const bigEvent = scoreCombo(ev(placements(5, 1, 64)), { ref: REF }).score;
check('evento più grande ⇒ score maggiore', bigEvent > smallEvent, `(${smallEvent} vs ${bigEvent})`);
const recentWin = scoreCombo(ev(placements(5, 1, 25, 2)), { ref: REF }).score;
const oldWin = scoreCombo(ev(placements(5, 1, 25, 200)), { ref: REF }).score;
check('risultati recenti ⇒ score maggiore', recentWin > oldWin, `(${oldWin} vs ${recentWin})`);
const winVsThird = scoreCombo(ev(placements(5, 1, 25)), { ref: REF }).score;
const thirdOnly = scoreCombo(ev(placements(5, 3, 25)), { ref: REF }).score;
check('1° posto pesa più del 3°', winVsThird > thirdOnly, `(${thirdOnly} vs ${winVsThird})`);

console.log('Soglie tag (boundary)');
// La combo dominante tocca la soglia "meta" (≥8.5); fringe resta sotto "top-tier" (<7.0).
check('dominant ha "top-tier"', dominant.tags.includes('top-tier'));
check('fringe NON ha "top-tier"', !fringe.tags.includes('top-tier'), `=${fringe.score}`);

console.log('useConfidence — shrinkage low-sample');
const single = ev(placements(1, 1, 33));            // 1 evento distinto
const singleNo = scoreCombo(single, { ref: REF }).score;
const singleYes = scoreCombo(single, { ref: REF, useConfidence: true }).score;
check('useConfidence abbassa lo score da campione unico', singleYes < singleNo, `(${singleYes} vs ${singleNo})`);
const many = ev(placements(8, 1, 33));               // 8 eventi distinti
const manyNo = scoreCombo(many, { ref: REF }).score;
const manyYes = scoreCombo(many, { ref: REF, useConfidence: true }).score;
check('useConfidence penalizza meno con molti eventi', (manyYes / manyNo) > (singleYes / singleNo), `(${manyYes / manyNo} vs ${singleYes / singleNo})`);

console.log('Tag rising (momentum)');
const rising = scoreCombo(ev([
  ...placements(5, 1, 25, 5),     // recente, forte
  ...placements(1, 3, 25, 120),   // storico, debole
]), { ref: REF });
check('combo con momentum recente ha "rising"', rising.tags.includes('rising'), JSON.stringify(rising.tags));
const declining = scoreCombo(ev([
  ...placements(1, 3, 25, 5),      // recente, debole
  ...placements(6, 1, 25, 120),    // storico, forte
]), { ref: REF });
check('combo in declino NON ha "rising"', !declining.tags.includes('rising'), JSON.stringify(declining.tags));
const onlyRecent = scoreCombo(ev(placements(5, 1, 25, 5)), { ref: REF });
check('senza storico (solo finestra recente) NON ha "rising"', !onlyRecent.tags.includes('rising'));

console.log('usageTrend');
check('trend up (share cresce)', usageTrend([
  { source: 'metabeys-leaderboard', date: '2026-04-01', window: '30d', sharePct: 5 },
  { source: 'metabeys-leaderboard', date: '2026-06-01', window: '30d', sharePct: 12 },
]) === 'up');
check('trend down (share cala)', usageTrend([
  { source: 'metabeys-leaderboard', date: '2026-04-01', window: '30d', sharePct: 14 },
  { source: 'metabeys-leaderboard', date: '2026-06-01', window: '30d', sharePct: 6 },
]) === 'down');
check('trend stable (variazione ≤1pt)', usageTrend([
  { source: 'metabeys-leaderboard', date: '2026-04-01', window: '30d', sharePct: 10 },
  { source: 'metabeys-leaderboard', date: '2026-06-01', window: '30d', sharePct: 10.5 },
]) === 'stable');
check('trend undefined con <2 snapshot', usageTrend([
  { source: 'metabeys-leaderboard', date: '2026-06-01', window: '30d', sharePct: 10 },
]) === undefined);

console.log('lastPlacementDate / stadiums (breakdown)');
const withStadium = scoreCombo(ev([
  { source: 'wbo-winning-combos', tier: 'structured', eventId: 'e1', eventName: 'X', date: '2026-06-10', placement: 1, players: 30, stadium: 'xtreme', lang: 'en' },
  { source: 'wbo-winning-combos', tier: 'structured', eventId: 'e2', eventName: 'Y', date: '2026-05-01', placement: 2, players: 30, stadium: 'infinity', lang: 'en' },
]), { ref: REF });
check('lastPlacementDate = placement più recente', withStadium.breakdown.lastPlacementDate === '2026-06-10', `=${withStadium.breakdown.lastPlacementDate}`);
check('stadiums raccoglie i piatti distinti', !!withStadium.breakdown.stadiums && withStadium.breakdown.stadiums.length === 2);

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
