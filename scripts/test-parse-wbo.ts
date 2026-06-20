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

// --- CX risolte (deterministico, order-agnostic + Western) ---
check('CX "PegasusBlast Wheel1-50Hexa"', comboId(r, 'PegasusBlast Wheel1-50Hexa') === 'pegasus-blast-wheel-1-50-hexa');
check('CX assist a nome intero "KrakenWriggle Heavy9-60Orb"', comboId(r, 'KrakenWriggle Heavy9-60Orb') === 'kraken-wriggle-heavy-9-60-orb');
check('CX Expand over+assist gluati "BahamutBlitz FlowKnuckle1-50Bound Spike"',
  comboId(r, 'BahamutBlitz FlowKnuckle1-50Bound Spike') === 'bahamut-flow-blitz-knuckle-1-50-bound-spike');
check('CX Expand over+assist gluati "ValkyrieBlitz BreakHeavy 9-60 Orb"',
  comboId(r, 'ValkyrieBlitz BreakHeavy 9-60 Orb') === 'valkyrie-break-blitz-heavy-9-60-orb');
check('CX order-agnostic: "Dran Brave S" e "Courage Dran S" (Western) → stesso id',
  comboId(r, 'Dran Brave S 9-60 Hexa') === 'dran-brave-slash-9-60-hexa' &&
  comboId(r, 'Courage Dran S 9-60 Hexa') === 'dran-brave-slash-9-60-hexa');
check('CX gluato order-agnostic "HellsArc Bumper 9-60 Hexa"', comboId(r, 'HellsArc Bumper 9-60 Hexa') === 'hells-arc-bumper-9-60-hexa');
const cxLine = parseComboLine(r, 'BahamutBlitz FlowKnuckle1-50Bound Spike');
check('CX emette i campi giusti (line/lockChip/overBlade/assistBlade)',
  cxLine.ok && cxLine.combo.line === 'cx' && cxLine.combo.lockChip === 'bahamut' &&
  cxLine.combo.overBlade === 'flow' && cxLine.combo.assistBlade === 'knuckle' && cxLine.combo.blade === null);

// --- Combo a parte integrata (ratchet incluso → ratchet null) ---
const intg1 = parseComboLine(r, 'BulletGriffon Hexa');
check('Integrata: blade UX a ratchet integrato "BulletGriffon Hexa" (line ux, ratchet null)',
  intg1.ok && intg1.combo.blade === 'bullet-griffon' && intg1.combo.bit === 'hexa' &&
  intg1.combo.ratchet === null && intg1.combo.line === 'ux');
const intg2 = parseComboLine(r, 'SharkScale Operate');
check('Integrata: Ratchet Integrated Bit + blade BX "SharkScale Operate" (ratchet null)',
  intg2.ok && intg2.combo.blade === 'shark-scale' && intg2.combo.bit === 'operate' && intg2.combo.ratchet === null);
const intg3 = parseComboLine(r, 'PegasusBlast Wheel Operate');
check('Integrata: Ratchet Integrated Bit + lama CX "PegasusBlast Wheel Operate" (cx, ratchet null)',
  intg3.ok && intg3.combo.line === 'cx' && intg3.combo.lockChip === 'pegasus' &&
  intg3.combo.bit === 'operate' && intg3.combo.ratchet === null);

// --- BX hardening: nome Western che ingloba ratchet+bit (oggi scartato dalla guard) ---
check('BX Western "Rock Golem 9-60 Hexa" → golem-rock', comboId(r, 'Rock Golem 9-60 Hexa') === 'golem-rock-9-60-hexa');
check('BX Western "Spear Scorpio 0-70 Hexa" → scorpio-spear', comboId(r, 'Spear Scorpio 0-70 Hexa') === 'scorpio-spear-0-70-hexa');
check('BX prefisso-username "Beezo PhoenixWing 3-60 Rush" → phoenix-wing', comboId(r, 'Beezo PhoenixWing 3-60 Rush') === 'phoenix-wing-3-60-rush');

// --- Devono restare unresolved (conservativo: niente combo inventate) ---
check('Refuso "SliverWolf 9-60 Hexa" → unresolved', isUnresolved(r, 'SliverWolf 9-60 Hexa'));
check('CX senza assist "BahamutBlitz BK1-50I" → unresolved', isUnresolved(r, 'BahamutBlitz BK1-50I'));
check('BX ambiguo per variante "Lightning L-Drago 5-60 Rush" → unresolved', isUnresolved(r, 'Lightning L-Drago 5-60 Rush'));
check('Dato mancante "Courage Dran ?3-60Low Flat" → unresolved', isUnresolved(r, 'Courage Dran ?3-60Low Flat'));
const bgTk = parseComboLine(r, 'BulletGriffon TK (Both Stages)');
check('Combo a parte integrata "BulletGriffon TK" → materializzata (ratchet null, line ux)',
  bgTk.ok && bgTk.combo.blade === 'bullet-griffon' && bgTk.combo.ratchet === null && bgTk.combo.line === 'ux');
check('Quote noise "SS 3-60 LR" → unresolved', isUnresolved(r, 'SS 3-60 LR'));
check('Ratchet Integrated Bit con ratchet N-MM "SharkScale 7-60 Operate" → unresolved (incoerente)', isUnresolved(r, 'SharkScale 7-60 Operate'));

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

// --- Segmentazione: col resolver raccoglie anche le righe a parte integrata (no ratchet N-MM) ---
const intgRaw = ['ORGANIZER', '  Today  12:23 AM', 'poster', 'Test Event', '', '🥇Winner', '', 'BulletGriffon Hexa', 'SharkScale Operate', ''].join('\n');
check('segment col resolver: raccoglie le righe integrate',
  (segmentThread(intgRaw, r)[0]?.placements[0]?.comboLinesRaw.length ?? 0) === 2);
check('segment senza resolver: NON raccoglie le righe integrate (comportamento storico invariato)',
  (segmentThread(intgRaw)[0]?.placements[0]?.comboLinesRaw.length ?? 0) === 0);

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
