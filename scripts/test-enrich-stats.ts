/**
 * test-enrich-stats.ts — golden test di parseStats, delle categorie di formato e dell'abbinamento di
 * scripts/enrich-stats.ts.
 *
 * Wikitext di esempio presi dalle risposte dell'API del wiki (infobox ridotto ai campi stat).
 * Non tocca file ne rete. Esegui: npx tsx scripts/test-enrich-stats.ts  (esce 1 se un assert fallisce).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseStats, parseStatsDettaglio, buildMap, pianifica, norm, leggiDueStati, type VoceDueStati } from './enrich-stats';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}
const box = (a: string, d: string, s: string) => `{{Part Infobox\n|Name=X\n|AttackStat=${a}\n|DefenseStat=${d}\n|StaminaStat=${s}\n|XStandard=✔️\n}}`;
const j = (x: unknown) => JSON.stringify(x);

// --- parseStats: intero e vuoto ---
check('intero puro', j(parseStats(box('25', '70', '35'))) === '{"atk":25,"def":70,"sta":35}');
check('intero: motivo intero', parseStatsDettaglio(box('25', '70', '35')).motivo === 'intero');
check('zero e un intero puro', j(parseStats(box('5', '0', '0'))) === '{"atk":5,"def":0,"sta":0}');
check('campi vuoti: nessuna stat, motivo vuoto', parseStats(box('', '', '')) === null && parseStatsDettaglio(box('', '', '')).motivo === 'vuoto');
check('campi assenti: motivo vuoto', parseStatsDettaglio('{{Part Infobox\n|Type=Defense\n}}').motivo === 'vuoto');
check('un campo vuoto basta a non applicare', parseStats(box('20', '', '10')) === null);

// --- le categorie di formato ---
const slash = parseStatsDettaglio(box('20/50', '50/35', '50/10'));
check('slash: motivo slash, stats null, due stati', slash.motivo === 'slash' && slash.stats === null
  && j(slash.stati) === '[{"atk":20,"def":50,"sta":50},{"atk":50,"def":35,"sta":10}]');
const freccia = parseStatsDettaglio(box('30 > 55', '30 > 20', '60 > 10'));
check('freccia: motivo freccia, due stati', freccia.motivo === 'freccia' && freccia.stats === null
  && j(freccia.stati) === '[{"atk":30,"def":30,"sta":60},{"atk":55,"def":20,"sta":10}]');
const frecciaSenzaSpazi = parseStatsDettaglio(box('25>55', '55 >25', '30 > 30'));
check('freccia: gli spazi attorno a > non contano', frecciaSenzaSpazi.motivo === 'freccia' && frecciaSenzaSpazi.stati![0].atk === 25 && frecciaSenzaSpazi.stati![1].def === 25);
const prodotti = parseStatsDettaglio(box('55<br>60 (2.0)', '25<br>27 (2.0)', '20<br>23 (2.0)'));
check('due prodotti: motivo prodotti, stats = primo valore, nessuno stato alt', prodotti.motivo === 'prodotti'
  && j(prodotti.stats) === '{"atk":55,"def":25,"sta":20}' && prodotti.stati === null);
check('due prodotti con <br/>', parseStatsDettaglio(box('55<br/>60 (2.0)', '25<br />27 (2.0)', '20<br>23 (2.0)')).motivo === 'prodotti');
const decimale = parseStatsDettaglio(box('12', '8.5', '9.5'));
check('decimale: motivo decimale, nessuna stat', decimale.motivo === 'decimale' && decimale.stats === null && decimale.stati === null);
check('altro: testo libero', parseStatsDettaglio(box('alto', '50', '10')).motivo === 'altro');
check('altro: categorie miste (slash e intero)', parseStatsDettaglio(box('20/50', '50', '50/10')).motivo === 'altro');
check('altro: slash con una freccia', parseStatsDettaglio(box('20/50', '50 > 35', '50/10')).motivo === 'altro');
check('nessuna categoria a due valori applica stats a un campo solo', parseStats(box('20', '50/35', '10')) === null);

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
check('fort prende la pagina Fort', j(per('fort')) === '{"atk":24,"def":12,"sta":24}');
check('fortress prende la pagina Fortress, non Fort', j(per('fortress')) === '{"atk":10,"def":20,"sta":10}');
check('blitz dalla famiglia Metal Blade', j(per('blitz')) === '{"atk":25,"def":10,"sta":5}');
check('pagina con campi vuoti: nessuna stat', per('force') === undefined && per('eclipse') === undefined);
check('parte senza pagina: nessuna stat', per('delta') === undefined);
check('conteggio guadagnano = 3', piano.guadagnano.length === 3, j(piano.guadagnano.map((x) => x.id)));

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

// --- due valori NON in elenco: elencata, non scritta, stat esistenti non cancellate ---
const due = buildMap(new Map([['Ratchet-Integrated Blade - HellsNether', box('50/70', '50/45', '30/15')]]));
const p5 = [{ id: 'hellsnether', names: { tt: 'HellsNether', hasbro: 'Nether Incendio' } }, { id: 'hellsnether-b', names: { tt: 'HellsNether' }, stats: { atk: 9, def: 9, sta: 9 } }];
const piano5 = pianifica(p5, [due], true);
check('due valori fuori elenco: elencata con il formato', piano5.dueValoriFuoriElenco.length === 2 && piano5.dueValoriFuoriElenco[0].id === 'hellsnether' && piano5.dueValoriFuoriElenco[0].formato === 'slash');
check('due valori fuori elenco: non scrive stats ne statsAlt e non cancella', (p5[0] as any).stats === undefined && (p5[0] as any).statsAlt === undefined && (p5[1] as any).stats.atk === 9);
check('due valori fuori elenco: non e in guadagnano', piano5.guadagnano.length === 0);

// --- due stati in elenco: slash (mode, con labels) e freccia (shift) ---
const famDue = buildMap(new Map([
  ['Ratchet-Integrated Bit - Operate', box('20/50', '50/35', '50/10')],
  ['Ratchet-Integrated Bit - Turbo', box('30 > 55', '30 > 20', '60 > 10')],
]));
const elenco: VoceDueStati[] = [
  { lista: 'bits', id: 'operate', kind: 'mode', labels: ['Attack Mode', 'Defense Mode'] },
  { lista: 'bits', id: 'turbo', kind: 'shift' },
];
const bits = () => [{ id: 'operate', names: { tt: 'Operate' } }, { id: 'turbo', names: { tt: 'Turbo' } }, { id: 'altro', names: { tt: 'Altro' } }];
const p7 = bits();
const piano7 = pianifica(p7, [famDue], true, elenco);
const op = p7[0] as any, tu = p7[1] as any;
check('operate: stats = primo valore', j(op.stats) === '{"atk":20,"def":50,"sta":50}');
check('operate: statsAlt = secondo valore, kind e labels dall elenco', j(op.statsAlt) === '{"kind":"mode","stats":{"atk":50,"def":35,"sta":10},"labels":["Attack Mode","Defense Mode"]}');
check('turbo: stats e statsAlt shift senza labels', j(tu.stats) === '{"atk":30,"def":30,"sta":60}' && j(tu.statsAlt) === '{"kind":"shift","stats":{"atk":55,"def":20,"sta":10}}' && !('labels' in tu.statsAlt));
check('statsAlt subito dopo stats nell oggetto', j(Object.keys(op)) === '["id","names","stats","statsAlt"]');
check('piano: due parti a due stati, entrambe statsAlt nuovo, guadagnano 2', piano7.dueStati.length === 2 && piano7.dueStati.every((x) => x.esito === 'nuovo') && piano7.guadagnano.length === 2);
check('parte fuori elenco e senza pagina: intatta', (p7[2] as any).stats === undefined && (p7[2] as any).statsAlt === undefined);

// dry: elencato ma non scritto
const p8 = bits();
const piano8 = pianifica(p8, [famDue], false, elenco);
check('dry: statsAlt elencato e non scritto', piano8.dueStati.length === 2 && p8.every((p: any) => p.stats === undefined && p.statsAlt === undefined));

// rilancio: invariato; statsAlt diverso: cambia; stats esistente sulla parte con statsAlt: posizione di statsAlt dopo stats
const piano9 = pianifica(p7, [famDue], true, elenco);
check('rilancio: statsAlt invariato, nessun guadagno ne cambio', piano9.dueStati.every((x) => x.esito === 'invariato') && piano9.guadagnano.length === 0 && piano9.cambiano.length === 0 && piano9.invariate === 2);
const p10 = [{ id: 'turbo', names: { tt: 'Turbo' }, stats: { atk: 30, def: 30, sta: 60 }, image: { file: 'turbo.png' } }];
const piano10 = pianifica(p10, [famDue], true, [elenco[1]]);
check('stats gia presenti uguali: statsAlt nuovo, inserito subito dopo stats', piano10.guadagnano.length === 0 && piano10.invariate === 1
  && j(Object.keys(p10[0])) === '["id","names","stats","statsAlt","image"]');
const p11 = [{ id: 'turbo', names: { tt: 'Turbo' }, stats: { atk: 30, def: 30, sta: 60 }, statsAlt: { kind: 'mode', stats: { atk: 1, def: 1, sta: 1 } } }];
const piano11 = pianifica(p11, [famDue], true, [elenco[1]]);
check('statsAlt diverso: esito cambia e viene riscritto', piano11.dueStati[0].esito === 'cambia' && (p11[0] as any).statsAlt.kind === 'shift');

// --- il formato cambia: la parte in elenco non ha piu due valori → errore chiaro, niente scritto ---
const famCambiata = buildMap(new Map([['Ratchet-Integrated Bit - Turbo', box('30', '30', '60')]]));
const p12 = [{ id: 'turbo', names: { tt: 'Turbo' } }];
let errore = '';
try { pianifica(p12, [famCambiata], true, [elenco[1]]); } catch (e) { errore = e instanceof Error ? e.message : String(e); }
check('formato cambiato (intero): solleva un errore che nomina parte e pagina', errore.includes('turbo') && errore.includes('Ratchet-Integrated Bit - Turbo') && errore.includes('due valori'), errore);
check('formato cambiato: nessuna stat scritta', (p12[0] as any).stats === undefined);
const famVuota = buildMap(new Map([['Ratchet-Integrated Bit - Turbo', box('', '', '')]]));
errore = '';
try { pianifica([{ id: 'turbo', names: { tt: 'Turbo' } }], [famVuota], true, [elenco[1]]); } catch (e) { errore = e instanceof Error ? e.message : String(e); }
check('campi diventati vuoti: solleva un errore', errore.includes('turbo'), errore);
errore = '';
try { pianifica([{ id: 'turbo', names: { tt: 'Turbo' } }], [buildMap(new Map())], true, [elenco[1]]); } catch (e) { errore = e instanceof Error ? e.message : String(e); }
check('pagina sparita dal wiki: solleva un errore', errore.includes('turbo') && errore.includes('pagina'), errore);
errore = '';
try { pianifica([{ id: 'altro', names: { tt: 'Altro' } }], [famDue], true, [elenco[1]]); } catch (e) { errore = e instanceof Error ? e.message : String(e); }
check('id dell elenco assente dal master: solleva un errore', errore.includes('turbo'), errore);

// --- due prodotti: stats = primo valore, nessuno statsAlt, elencati ---
const famProd = buildMap(new Map([['Blade - DranSword', box('55<br>60 (2.0)', '25<br>27 (2.0)', '20<br>23 (2.0)')]]));
const p13 = [{ id: 'dran-sword', names: { tt: 'DranSword' } }, { id: 'dran-sword-b', names: { tt: 'DranSword' }, stats: { atk: 55, def: 25, sta: 20 } }];
const piano13 = pianifica(p13, [famProd], true);
check('due prodotti: stats = primo valore, nessun statsAlt', j((p13[0] as any).stats) === '{"atk":55,"def":25,"sta":20}' && (p13[0] as any).statsAlt === undefined);
check('due prodotti: elencati nel piano, il valore esistente uguale resta invariato', piano13.dueProdotti.length === 2 && piano13.guadagnano.length === 1 && piano13.invariate === 1);

// --- decimale e altro: elencati, non scritti ---
const famDec = buildMap(new Map([['Ratchet - 5-70', box('12', '8.5', '9.5')], ['Ratchet - X-1', box('a', 'b', 'c')]]));
const p14 = [{ id: '5-70', names: { tt: '5-70' }, stats: { atk: 12, def: 8, sta: 10 } }, { id: 'x-1', names: { tt: 'X-1' } }];
const piano14 = pianifica(p14, [famDec], true);
check('decimale: elencato e non applicato, stat esistenti intatte', piano14.decimali.length === 1 && piano14.decimali[0].id === '5-70' && (p14[0] as any).stats.def === 8 && piano14.cambiano.length === 0);
check('altro: elencato e non scritto', piano14.altri.length === 1 && (p14[1] as any).stats === undefined);

// famiglie in disaccordo sulla stessa chiave: ambigua, non toccata
const a = buildMap(new Map([['Main Blade - Dup', box('1', '1', '1')]]));
const b = buildMap(new Map([['Metal Blade - Dup', box('2', '2', '2')]]));
const p6 = [{ id: 'dup', names: { tt: 'Dup' } }];
const piano6 = pianifica(p6, [a, b], true);
check('famiglie in disaccordo: ambigua e non scritta', piano6.ambigue.length === 1 && (p6[0] as any).stats === undefined);

// --- elenco reale: forma e contenuto di data/parts-due-stati.json ---
const reale = leggiDueStati(readFileSync(join(import.meta.dirname, '..', 'data', 'parts-due-stati.json'), 'utf8'));
const chiave = (l: string, i: string) => reale.find((e) => e.lista === l && e.id === i);
check('elenco reale: operate mode, turbo shift, scorpio-spear shift', chiave('bits', 'operate')?.kind === 'mode' && chiave('bits', 'turbo')?.kind === 'shift' && chiave('blades', 'scorpio-spear')?.kind === 'shift' && reale.length === 3);
check('elenco reale: hellsnether e le 2.0 non ci sono', !reale.some((e) => ['hellsnether', 'dran-sword', 'hells-scythe', 'knight-shield', 'wizard-arrow'].includes(e.id)));
for (const [nome, testo] of [
  ['non array', '{}'],
  ['kind sbagliato', '[{"lista":"bits","id":"x","kind":"version"}]'],
  ['lista sbagliata', '[{"lista":"cose","id":"x","kind":"mode"}]'],
  ['labels a una voce', '[{"lista":"bits","id":"x","kind":"mode","labels":["a"]}]'],
  ['duplicato', '[{"lista":"bits","id":"x","kind":"mode"},{"lista":"bits","id":"x","kind":"shift"}]'],
] as const) {
  let ko = false;
  try { leggiDueStati(testo); } catch { ko = true; }
  check(`elenco non valido rifiutato: ${nome}`, ko);
}

// norm
check('norm', norm('Ratchet-Integrated Blade') === 'ratchetintegratedblade' && norm(null) === '');

if (failed) { console.error(`\n${failed} controlli falliti`); process.exit(1); }
console.log('\nOK: enrich-stats');
