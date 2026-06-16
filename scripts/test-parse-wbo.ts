/**
 * test-parse-wbo.ts — Golden test del parser WBO deterministico. Verifica resolver, parseComboLine
 * (BX/CX/no-ratchet/sigla/bit a 2 parole/alias/guard landmine), il parsing di eventId/date/players e
 * la segmentazione del thread (incluse le medaglie emoji, che sono surrogate pair).
 *
 * Esegui: npx tsx scripts/test-parse-wbo.ts
 */
import { buildResolver, parseComboLine, parseEventId, parseDate, parsePlayers, parseStadium, parseEventName, segmentThread } from './lib/wbo-parse';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) pass++;
  else { fail++; console.error(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}
function comboId(r: ReturnType<typeof buildResolver>, line: string): string | null {
  const res = parseComboLine(r, line);
  return res.ok ? res.combo.id : null;
}
function isUnresolved(r: ReturnType<typeof buildResolver>, line: string): boolean {
  return !parseComboLine(r, line).ok;
}

const r = buildResolver();

// --- BX puliti ---
check('WizardRod 1-60Hexa', comboId(r, 'WizardRod 1-60Hexa (First Stage & Final Stage)') === 'wizard-rod-1-60-hexa');
check('SharkScale 3-60Free Ball (bit 2 parole)', comboId(r, 'SharkScale 3-60Free Ball') === 'shark-scale-3-60-free-ball');
check('AeroPegasus 1-50Rush', comboId(r, 'AeroPegasus 1-50Rush') === 'aero-pegasus-1-50-rush');
check('Emoji event spaced "WizardRod 1-60 Hexa"', comboId(r, 'WizardRod 1-60 Hexa') === 'wizard-rod-1-60-hexa');

// --- Sigle ufficiali (codice bit) ---
check('SharkScale 1-70H → hexa via sigla', comboId(r, 'SharkScale 1-70H (Both Stages)') === 'shark-scale-1-70-hexa');
check('SharkScale 1-70LR → low-rush via sigla', comboId(r, 'SharkScale 1-70LR') === 'shark-scale-1-70-low-rush');
check('WizardRod 3-60FB → free-ball via sigla', comboId(r, 'WizardRod 3-60FB') === 'wizard-rod-3-60-free-ball');
check('MeteorDragoon 9-60E → elevate via sigla', comboId(r, 'MeteorDragoon 9-60E') === 'meteor-dragoon-9-60-elevate');

// --- Alias di scrittura (inversione parole) ---
check('WyvernHover 9-60Kick → hover-wyvern via alias', comboId(r, 'WyvernHover 9-60Kick') === 'hover-wyvern-9-60-kick');
check('Hover Wyvern 7-60J → hover-wyvern', comboId(r, 'Hover Wyvern 7-60J') === 'hover-wyvern-7-60-jolt');

// --- Guard landmine: il nameWestern "Meteoroid Dragoon 3-70J" NON deve sviare il match ---
check('MeteorDragoon 3-70J risolve al blade giusto', comboId(r, 'MeteorDragoon 3-70J') === 'meteor-dragoon-3-70-jolt');

// --- CX e righe non risolvibili → unresolved ---
check('CX "PegasusBlast Wheel1-50Hexa" → unresolved', isUnresolved(r, 'PegasusBlast Wheel1-50Hexa'));
check('CX "BahamutBlitz FlowKnuckle1-50Bound Spike" → unresolved', isUnresolved(r, 'BahamutBlitz FlowKnuckle1-50Bound Spike'));
check('CX "KrakenWriggle Heavy9-60Orb" → unresolved', isUnresolved(r, 'KrakenWriggle Heavy9-60Orb'));
check('No-ratchet "BulletGriffon TK" → unresolved', isUnresolved(r, 'BulletGriffon TK (Both Stages)'));
check('Quote noise "SS 3-60 LR" → unresolved', isUnresolved(r, 'SS 3-60 LR'));

// --- eventId ---
check('eventId pid', parseEventId('Event Page Link: https://worldbeyblade.org/Thread-NEBO-X-...pid1928493', 'NEBO', '2026-06-14') === 'wbo-pid-1928493');
check('eventId thread', parseEventId('Event Page Link: https://worldbeyblade.org/Thread-Waffles...nt--126198', 'Waffles', '2026-06-13') === 'wbo-thread-126198');
check('eventId thread label-agnostic (Event Page:)', parseEventId('Event Page: https://worldbeyblade.org/Thread-X-Masters-51--126195', 'X Masters 51', '2026-06-14') === 'wbo-thread-126195');
check('eventId challonge con locale /tr/', parseEventId('115 player tournament in Turkiye: https://challonge.com/tr/mptzhn5t', 'Turkiye', '2026-06-15') === 'wbo-challonge-mptzhn5t');
check('eventId fallback slug+data', parseEventId('Event Page Link:Event Thread', "Summit's Crown", '2026-06-13').startsWith('wbo-summit-s-crown'));

// --- date ---
check('date Date: MM/DD/YYYY', parseDate('Date: 06/14/2026', '2026-06-15') === '2026-06-14');
check('date bare MM/DD/YYYY', parseDate('Bracket Link: x\n06/14/2026\nUnranked', '2026-06-15') === '2026-06-14');
check('date fallback fetchedAt', parseDate('115 player tournament in Turkiye', '2026-06-15') === '2026-06-15');

// --- players ---
check('players Player Count', parsePlayers('Player Count: 15') === 15);
check('players Participants', parsePlayers('32 Participants') === 32);
check('players player tournament', parsePlayers('115 player tournament in Turkiye') === 115);
check('players assente → undefined', parsePlayers('no count here') === undefined);

// --- stadium ---
check('stadium Xtreme (TAKARA TOMY)', parseStadium('Stadium: Xtreme Stadium (TAKARA TOMY)') === 'xtreme');
check('stadium BX-10 Xtreme', parseStadium('Stadium: BX-10 Xtreme Stadium') === 'xtreme');
check('stadium Extreme (variante)', parseStadium('Stadium: Extreme Stadium') === 'xtreme');
check('stadium Infinity', parseStadium('Stadium: Infinity Stadium') === 'infinity');
check('stadium assente → undefined', parseStadium('Optional Rules: none') === undefined);

// --- eventName: deve preferire il titolo del torneo, NON lo username del poster ---
check('eventName da slug thread', parseEventName('Event Page Link: https://worldbeyblade.org/Thread-Untouchables-Locals-June-13th--126198', []) === 'Untouchables Locals June 13th');
check('eventName scarta username (token unico) e prende la riga-titolo',
  parseEventName('', ['Shawn514', '115 player tournament in Turkiye']) === '115 player tournament in Turkiye');
check('eventName ripulisce URL dalla riga-titolo',
  parseEventName('', ['derincanleylek', '115 player tournament in Turkiye: https://challonge.com/tr/mptzhn5t']) === '115 player tournament in Turkiye');
check('eventName vuoto se solo username', parseEventName('', ['Shawn514']) === '');

// --- Segmentazione deterministica: medaglie emoji (surrogate pair) ---
const emojiRaw = [
  'ORGANIZER',
  '  Today  12:23 AM',
  'derincanleylek  ',
  '115 player tournament in Turkiye: https://challonge.com/tr/mptzhn5t',
  '',
  '🥇Chunkykitkatt',
  '',
  'WizardRod 1-60 Hexa',
  'SharkScale 3-60 Low Rush',
  '',
  '🥈Asensio',
  '',
  'WizardRod 9-60 Free Ball',
].join('\n');
const segEvents = segmentThread(emojiRaw);
check('segment: evento emoji riconosciuto', segEvents.length === 1);
check('segment: due posizioni 🥇🥈', segEvents[0]?.placements.length === 2, JSON.stringify(segEvents[0]?.placements?.map((p) => p.rank)));
check('segment: 🥇 = rank 1', segEvents[0]?.placements[0]?.rank === 1);
check('segment: combo sotto 🥇 raccolte', (segEvents[0]?.placements[0]?.comboLinesRaw.length ?? 0) === 2);
check('segment: eventName = titolo torneo, non username "derincanleylek"',
  segEvents[0]?.eventName === '115 player tournament in Turkiye', JSON.stringify(segEvents[0]?.eventName));

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
