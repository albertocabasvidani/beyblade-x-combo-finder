/**
 * test-wbo-fetch.ts — golden test delle funzioni pure di fetch-wbo.ts (scripts/lib/wbo-fetch-utils.ts).
 *
 * Copre il difetto misurato il 26/09/2026 (38 run su 52 con «ultima pagina = 1»): un documento vuoto,
 * intermedio o di challenge non deve passare per thread, e un numero di pagina che arretra rispetto
 * alla cache non va creduto. Esegui: npx tsx scripts/test-wbo-fetch.ts  (esce 1 se un assert fallisce).
 */
import { maxPageFrom, newestIso, looksLikeThread, isPlausibleLastPage, cacheFrontier, cacheFloor, pageFromUrl } from './lib/wbo-fetch-utils';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}

// Fixture: innerText di una pagina-thread MyBB (estratto), documento intermedio, challenge in due lingue.
const PAGINA_THREAD = [
  'World Beyblade Organization', 'Winning Combinations at WBO Organized Events - Beyblade X (BBX)',
  'Pages (155): « Previous 1 … 153 154 155', 'Subscribe to this thread',
  'ORGANIZER', 'Sep. 02, 2026  10:22 PM', 'Date: 08/30/2026', '1st BulletGriffon 1-60 Hexa',
].join('\n');
const HTML_THREAD = '<a href="?page=154">154</a><a href="?page=155">155</a> Pages (155)';
const DOCUMENTO_VUOTO = '';
const DOCUMENTO_INTERMEDIO = 'World Beyblade Organization\nLogin\nRegister\nSearch';
const CHALLENGE_IT = 'worldbeyblade.org\nEsecuzione della verifica di sicurezza\n\nQuesto sito web utilizza un servizio di sicurezza per la protezione dai bot dannosi.\nRay ID: a41384026905c69a\nPrestazioni e sicurezza di Cloudflare';
const CHALLENGE_EN = 'Just a moment...\nworldbeyblade.org\nVerify you are human by completing the action below.\nCloudflare';

console.log('maxPageFrom');
check('legge ?page=N e Pages (N), prende il massimo', maxPageFrom(HTML_THREAD) === 155, `=${maxPageFrom(HTML_THREAD)}`);
check('documento vuoto → 1', maxPageFrom(DOCUMENTO_VUOTO) === 1);
check('documento intermedio → 1', maxPageFrom(DOCUMENTO_INTERMEDIO) === 1);

console.log('newestIso');
check('Date: MM/DD/YYYY', newestIso('Date: 08/30/2026') === '2026-08-30');
check('timestamp MyBB MM-DD-YYYY', newestIso('09-02-2026, 10:22 PM') === '2026-09-02');
check('prende la più recente', newestIso('Date: 08/30/2026 ... 09-02-2026') === '2026-09-02');
check('nessuna data → null', newestIso(DOCUMENTO_VUOTO) === null);

console.log('looksLikeThread');
check('pagina-thread → sì', looksLikeThread(PAGINA_THREAD));
check('documento vuoto → no', !looksLikeThread(DOCUMENTO_VUOTO));
check('documento intermedio → no', !looksLikeThread(DOCUMENTO_INTERMEDIO));
check('challenge in italiano → no', !looksLikeThread(CHALLENGE_IT));
check('challenge in inglese → no', !looksLikeThread(CHALLENGE_EN));

console.log('isPlausibleLastPage');
check('1 con frontiera 155 → no (il difetto del 26/09)', !isPlausibleLastPage(1, 155));
check('155 con frontiera 155 → sì', isPlausibleLastPage(155, 155));
check('161 con frontiera 155 → sì', isPlausibleLastPage(161, 155));
check('prima esecuzione (frontiera 0) → sì', isPlausibleLastPage(1, 0));
check('0 → no', !isPlausibleLastPage(0, 0));
check('NaN → no', !isPlausibleLastPage(NaN, 0));

console.log('cacheFrontier');
check('pagina massima fra le chiavi', cacheFrontier({ '50': 'a', '155': 'b', '148': 'c' }) === 155);
check('cache vuota → 0', cacheFrontier({}) === 0);
check('cache assente → 0', cacheFrontier(undefined) === 0);

console.log('cacheFloor');
check('pagina minima fra le chiavi', cacheFloor({ '50': 'a', '155': 'b', '148': 'c' }) === 50);
check('cache vuota → 0', cacheFloor({}) === 0);

console.log('pageFromUrl');
check('?page=155', pageFromUrl('https://worldbeyblade.org/Thread-X?page=155#pid1') === 155);
check('&page=3', pageFromUrl('https://worldbeyblade.org/printthread.php?tid=1&page=3') === 3);
check('senza page → null', pageFromUrl('https://worldbeyblade.org/Thread-X?action=lastpost') === null);

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
