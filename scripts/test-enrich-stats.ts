/**
 * test-enrich-stats.ts — golden test di parseStats e dell'abbinamento di scripts/enrich-stats.ts.
 *
 * Wikitext di esempio presi dalle risposte dell'API del wiki (infobox ridotto ai campi stat).
 * Non tocca file ne rete. Esegui: npx tsx scripts/test-enrich-stats.ts  (esce 1 se un assert fallisce).
 */
import { parseStats, parseStatsDettaglio, buildMap, pianifica, norm } from './enrich-stats';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}
const box = (a: string, d: string, s: string) => `{{Part Infobox\n|Name=X\n|AttackStat=${a}\n|DefenseStat=${d}\n|StaminaStat=${s}\n|XStandard=✔️\n}}`;

// --- parseStats ---
check('intero puro', JSON.stringify(parseStats(box('25', '70', '35'))) === '{"atk":25,"def":70,"sta":35}');
check('zero e un intero puro', JSON.stringify(parseStats(box('5', '0', '0'))) === '{"atk":5,"def":0,"sta":0}');
check('campi vuoti: nessuna stat, motivo vuoto', parseStats(box('', '', '')) === null && parseStatsDettaglio(box('', '', '')).motivo === 'vuoto');
check('campi assenti: motivo vuoto', parseStatsDettaglio('{{Part Infobox\n|Type=Defense\n}}').motivo === 'vuoto');
check('due modalita 50/70', parseStats(box('50/70', '50/45', '30/15')) === null && parseStatsDettaglio(box('50/70', '50/45', '30/15')).motivo === 'duemodalita');
check('due modalita 30 > 55', parseStatsDettaglio(box('30 > 55', '30 > 20', '60 > 10')).motivo === 'duemodalita');
check('un solo campo a due modalita basta a non applicare', parseStats(box('20', '50/35', '10')) === null);
check('un campo vuoto basta a non applicare', parseStats(box('20', '', '10')) === null);

// --- abbinamento: Main Blade - Fort contro Metal Blade - Fortress ---
const main = buildMap(new Map([
  ['Main Blade - Fort', box('24', '12', '24')],
  ['Main Blade - Eclipse', box('', '', '')],
]));
const metal = buildMap(new Map([
  ['Metal Blade - Fortress', box('10', '20', '10')],
  ['Metal Blade - Blitz', box('25', '10', '5')],
  ['Metal Blade - Force', box('', '', '')],
]));
const parti = () => [
  { id: 'fort', names: { tt: 'Fort', hasbro: null } },
  { id: 'fortress', names: { tt: 'Fortress', hasbro: 'Armor' } },
  { id: 'blitz', names: { tt: 'Blitz', hasbro: 'Blitz' } },
  { id: 'force', names: { tt: 'Force', hasbro: null } },
  { id: 'eclipse', names: { tt: 'Eclipse', hasbro: null } },
  { id: 'delta', names: { tt: 'Delta', hasbro: null } },
];
const p1 = parti();
const piano = pianifica(p1, [main, metal], true);
const per = (id: string) => (p1.find((p) => p.id === id) as any).stats;
check('fort prende la pagina Fort', JSON.stringify(per('fort')) === '{"atk":24,"def":12,"sta":24}');
check('fortress prende la pagina Fortress, non Fort', JSON.stringify(per('fortress')) === '{"atk":10,"def":20,"sta":10}');
check('blitz dalla famiglia Metal Blade', JSON.stringify(per('blitz')) === '{"atk":25,"def":10,"sta":5}');
check('pagina con campi vuoti: nessuna stat', per('force') === undefined && per('eclipse') === undefined);
check('parte senza pagina: nessuna stat', per('delta') === undefined);
check('conteggio guadagnano = 3', piano.guadagnano.length === 3, JSON.stringify(piano.guadagnano.map((x) => x.id)));

// dry: non scrive
const p2 = parti();
pianifica(p2, [main, metal], false);
check('dry non scrive stats', p2.every((p: any) => p.stats === undefined));

// cambia valore: elencato e, senza dry, sovrascritto
const p3 = [{ id: 'fort', names: { tt: 'Fort' }, stats: { atk: 1, def: 2, sta: 3 } }];
const piano3 = pianifica(p3, [main], false);
check('valore diverso elencato in cambiano', piano3.cambiano.length === 1 && piano3.cambiano[0].vecchio.atk === 1 && piano3.cambiano[0].nuovo.atk === 24);
check('dry lascia il vecchio valore', (p3[0] as any).stats.atk === 1);
const p4 = [{ id: 'fort', names: { tt: 'Fort' }, stats: { atk: 24, def: 12, sta: 24 } }];
const piano4 = pianifica(p4, [main], true);
check('stessi valori: invariata', piano4.invariate === 1 && piano4.cambiano.length === 0 && piano4.guadagnano.length === 0);

// due modalita: parte elencata, stats non scritte, stats esistenti non cancellate
const due = buildMap(new Map([['Ratchet-Integrated Blade - HellsNether', box('50/70', '50/45', '30/15')]]));
const p5 = [{ id: 'hellsnether', names: { tt: 'HellsNether', hasbro: 'Nether Incendio' } }, { id: 'hellsnether-b', names: { tt: 'HellsNether' }, stats: { atk: 9, def: 9, sta: 9 } }];
const piano5 = pianifica(p5, [due], true);
check('due modalita elencata', piano5.duemodalita.length === 2 && piano5.duemodalita[0].id === 'hellsnether');
check('due modalita non scrive e non cancella', (p5[0] as any).stats === undefined && (p5[1] as any).stats.atk === 9);

// famiglie in disaccordo sulla stessa chiave: ambigua, non toccata
const a = buildMap(new Map([['Main Blade - Dup', box('1', '1', '1')]]));
const b = buildMap(new Map([['Metal Blade - Dup', box('2', '2', '2')]]));
const p6 = [{ id: 'dup', names: { tt: 'Dup' } }];
const piano6 = pianifica(p6, [a, b], true);
check('famiglie in disaccordo: ambigua e non scritta', piano6.ambigue.length === 1 && (p6[0] as any).stats === undefined);

// norm
check('norm', norm('Ratchet-Integrated Blade') === 'ratchetintegratedblade' && norm(null) === '');

if (failed) { console.error(`\n${failed} controlli falliti`); process.exit(1); }
console.log('\nOK: enrich-stats');
