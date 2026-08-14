/**
 * test-wiki-scan.ts — Collaudo della catena di aggiornamento parti (scan-wiki-updates + merge).
 *
 * Risponde a tre domande, che sono le tre garanzie chieste al job giornaliero:
 *   A) il registro copre TUTTO quello che c'e' oggi sul wiki;
 *   B) una novita' viene inclusa (riga nuova in lista, revid cambiato, membro di multipack,
 *      pagina prima inesistente che nasce);
 *   C) non si creano DOPPIONI (redirect Hasbro, ri-elenchi dei Limited, merge per alias).
 *
 * NON TOCCA IL DATABASE. Ogni scrittura finisce in tmp/test-wiki/; il test 0 calcola gli hash
 * SHA-256 dei quattro file di data/ prima e dopo e pretende che siano identici. Se un domani
 * qualcuno rompe l'isolamento (un flag dimenticato, un default cambiato), e' la suite stessa a
 * fallire invece del database a corrompersi.
 *
 * Esegui: npm run test:wiki-scan   (esce 1 se un assert fallisce)
 * Richiede rete: interroga l'API di Fandom in sola lettura.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { parseListRows, parseContentsLinks, classifyKind } from './scan-wiki-updates';
import { batchQuery, fetchWikitextByTitle, sanitizeFilename } from './lib/wiki';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const WORK = join(ROOT, 'tmp', 'test-wiki');
const FIXT = join(WORK, 'fixtures');

const LIST_TT = 'List of Beyblade X products (Takara Tomy)';
const LIST_HAS = 'List of Beyblade X products (Hasbro)';
const SORVEGLIATI = ['parts-master.json', 'parts.json', 'wiki-scan.json', 'scan-history.json'];

let falliti = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ok  ${name}`);
  else { console.error(`  NO  ${name} ${extra}`); falliti++; }
}
function titolo(s: string): void { console.log(`\n=== ${s}`); }

function hashData(): Record<string, string> {
  const h: Record<string, string> = {};
  for (const f of SORVEGLIATI) {
    const p = join(DATA, f);
    h[f] = existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'ASSENTE';
  }
  return h;
}

function tsx(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

// ------------------------------------------------------------------ preparazione
rmSync(WORK, { recursive: true, force: true });
mkdirSync(FIXT, { recursive: true });
const hashPrima = hashData();

const statoReale = join(DATA, 'wiki-scan.json');
const haStato = existsSync(statoReale);
const stato: { pages: Record<string, any>; lists: Record<string, any> } =
  haStato ? JSON.parse(readFileSync(statoReale, 'utf8')) : { pages: {}, lists: {} };
if (!haStato) console.log('NOTA: data/wiki-scan.json non esiste ancora — i test di copertura (A) restano informativi.');

console.log('Scarico le pagine-lista una volta sola (fixture riusate da piu\' test)...');
const wtTT = await fetchWikitextByTitle(LIST_TT);
const wtHas = await fetchWikitextByTitle(LIST_HAS);
writeFileSync(join(FIXT, sanitizeFilename(LIST_TT) + '.txt'), wtTT);
writeFileSync(join(FIXT, sanitizeFilename(LIST_HAS) + '.txt'), wtHas);

const righeTT = parseListRows(wtTT);
const righeHas = parseListRows(wtHas);
const tuttiTitoli = [...new Set([...righeTT, ...righeHas])];

// ------------------------------------------------------------------ 0. isolamento (ri-verificato in coda)
titolo('0. Il database non viene toccato');
check('hash di data/ acquisiti', Object.keys(hashPrima).length === SORVEGLIATI.length);

// ------------------------------------------------------------------ A. copertura
titolo('A. Copertura di cio\' che c\'e\' oggi sul wiki');

const vw = tsx(['scripts/verify-against-wiki.ts', '--strict']);
check('verify:wiki --strict esce 0 (nessuna parte del wiki manca dal master)', vw.code === 0,
  vw.out.split('\n').filter((l) => l.includes('Totale:') || l.includes('STRICT')).join(' | '));

const canonTutti = await batchQuery(tuttiTitoli);
const canonici = [...new Set([...canonTutti.values()].filter((i) => !i.missing).map((i) => i.canonical))];
const ignoti = canonici.filter((t) => !stato.pages[t]);
if (haStato) {
  check(`ogni titolo delle liste e\' tracciato in wiki-scan.json (${canonici.length} canonici)`,
    ignoti.length === 0, ignoti.length ? `ignoti: ${ignoti.slice(0, 8).join(', ')}${ignoti.length > 8 ? ` (+${ignoti.length - 8})` : ''}` : '');
} else {
  console.log(`  --  ${canonici.length} titoli canonici dalle liste, ${ignoti.length} non ancora tracciati (informativo)`);
}

// Membri dei multipack: le parti X-Over stanno solo li' dentro, non nelle liste.
const multipackNoti = Object.keys(stato.pages).filter((t) => ['multipack', 'set', 'randombooster'].includes(stato.pages[t]?.kind)).slice(0, 5);
if (haStato && multipackNoti.length) {
  const membriIgnoti: string[] = [];
  for (const t of multipackNoti) {
    const membri = parseContentsLinks(await fetchWikitextByTitle(t));
    if (!membri.length) continue;
    for (const [, i] of await batchQuery(membri)) {
      if (!i.missing && !stato.pages[i.canonical]) membriIgnoti.push(`${i.canonical} (da ${t})`);
    }
  }
  check(`i membri in ==Contents== dei multipack sono tracciati (campione di ${multipackNoti.length})`,
    membriIgnoti.length === 0, membriIgnoti.slice(0, 5).join(', '));
} else {
  console.log('  --  campione multipack non disponibile (stato assente o senza multipack)');
}

// ------------------------------------------------------------------ B. le novita' entrano
titolo('B. Le novita\' vengono incluse');

/**
 * Stato sintetico che parte GIA' allineato al wiki: tutti i titoli canonici delle liste col loro
 * revid vero. Cosi' ogni scan di prova produce una worklist minuscola e il test misura una cosa
 * sola. (Partire da uno stato vuoto farebbe risultare "nuove" tutte e 258 le pagine, che lo scan
 * pre-scaricherebbe una per una: minuti di rete per un assert.)
 */
const revidVeri = new Map<string, number>();
for (const i of canonTutti.values()) if (!i.missing) revidVeri.set(i.canonical, i.revid!);

function statoAllineato(tag: string, ritocca?: (pages: Record<string, any>) => void): string {
  const pages: Record<string, any> = {};
  for (const [t, revid] of revidVeri) {
    pages[t] = { revid, timestamp: null, lastScannedDate: '2026-01-01', kind: classifyKind(t), kindSource: 'heuristic' };
  }
  ritocca?.(pages);
  const p = join(WORK, `stato-${tag}.json`);
  writeFileSync(p, JSON.stringify({ version: 1, lists: {}, pages }, null, 2));
  return p;
}

function scanDiProva(statoPath: string, tag: string): any {
  const wl = join(WORK, `worklist-${tag}.json`);
  const r = tsx(['scripts/scan-wiki-updates.ts', '--state', statoPath, '--worklist', wl,
    '--lists-from', FIXT, '--fetch-dir', join(WORK, `fetch-${tag}`)]);
  if (r.code !== 0) { console.error(r.out.slice(-1200)); return null; }
  return JSON.parse(readFileSync(wl, 'utf8'));
}

// Stato gia' allineato: la worklist deve essere vuota. E' anche il test del percorso quotidiano.
const sZero = statoAllineato('zero');
const wZero = scanDiProva(sZero, 'zero');
check('con stato allineato al wiki la worklist e\' vuota (percorso quotidiano)',
  !!wZero && wZero.pages.length === 0,
  wZero ? JSON.stringify(wZero.pages.map((p: any) => [p.title, p.reason])) : 'scan fallito');

// B4 — riga sintetica iniettata nella lista TT: deve comparire come "new".
// Titolo di una pagina VERA ma assente dalle liste (e' membro di un multipack), cosi' l'unica
// differenza rispetto allo stato allineato e' la riga iniettata.
const FINTO = 'Iron Man 4-80B';
const conRiga = wtTT.replace(/\n\|-\n\|BX-01\n/, `\n|-\n|BX-99\n|Booster [[${FINTO}]]\n|-\n|BX-01\n`);
check('la riga sintetica e\' stata iniettata nella fixture', conRiga !== wtTT);
check(`il titolo di prova non e\' gia\' nelle liste`, !revidVeri.has(FINTO));
writeFileSync(join(FIXT, sanitizeFilename(LIST_TT) + '.txt'), conRiga);
const w1 = scanDiProva(statoAllineato('nuova'), 'nuova');
check('una riga nuova nella lista finisce in worklist come "new"',
  !!w1 && w1.pages.some((p: any) => p.title === FINTO && p.reason === 'new'),
  w1 ? `worklist: ${JSON.stringify(w1.pages.map((p: any) => [p.title, p.reason]))}` : 'scan fallito');
writeFileSync(join(FIXT, sanitizeFilename(LIST_TT) + '.txt'), wtTT); // ripristino

// B5 — revid retrocesso su una pagina nota: deve comparire come "changed".
const NOTO = [...revidVeri.keys()].find((t) => classifyKind(t) === 'product')!;
const revidNoto = revidVeri.get(NOTO)!;
const w2 = scanDiProva(statoAllineato('cambiata', (p) => { p[NOTO].revid = revidNoto - 1; }), 'cambiata');
check('un revid piu\' vecchio del wiki produce "changed" col prevRevid giusto',
  !!w2 && w2.pages.some((p: any) => p.title === NOTO && p.reason === 'changed' && p.prevRevid === revidNoto - 1),
  w2 ? JSON.stringify(w2.pages.map((p: any) => [p.title, p.reason, p.prevRevid])) : 'scan fallito');

// B6 — membri di un multipack assenti dallo stato: il fixpoint ==Contents== deve pescarli.
const MULTI = [...revidVeri.keys()].find((t) => classifyKind(t) === 'multipack')!;
const membriVeri = parseContentsLinks(await fetchWikitextByTitle(MULTI));
const w3 = scanDiProva(statoAllineato('membri', (p) => { p[MULTI].revid = revidVeri.get(MULTI)! - 1; }), 'membri');
const membriInWorklist = w3 ? w3.pages.filter((p: any) => p.via.startsWith('contents:')).map((p: any) => p.title) : [];
check(`i membri in ==Contents== di "${MULTI}" entrano in worklist con via "contents:"`,
  membriInWorklist.length > 0,
  `membri della pagina: ${membriVeri.join(', ')} | in worklist: ${membriInWorklist.join(', ')}`);

// B7 — pagina registrata come link rosso che ora esiste: deve tornare "new", non solo-revid.
const w4 = scanDiProva(statoAllineato('risorta', (p) => {
  p[NOTO] = { revid: null, timestamp: null, lastScannedDate: '2026-01-01', kind: 'missing', kindSource: 'heuristic' };
}), 'risorta');
check('una pagina registrata "missing" che ora esiste rientra in worklist come "new"',
  !!w4 && w4.pages.some((p: any) => p.title === NOTO && p.reason === 'new'),
  w4 ? JSON.stringify(w4.pages.map((p: any) => [p.title, p.reason])) : 'scan fallito');

// ------------------------------------------------------------------ C. niente doppioni
titolo('C. I doppioni vengono evitati');

const coppia = await batchQuery(['Sword Dran 3-60F', 'DranSword 3-60F']);
const a = coppia.get('Sword Dran 3-60F')!, b = coppia.get('DranSword 3-60F')!;
check('il redirect Hasbro risolve alla stessa pagina canonica del titolo TT', a.canonical === b.canonical,
  `${a.canonical} vs ${b.canonical}`);
check('e porta lo stesso revid (non quello dello stub)', a.revid === b.revid, `${a.revid} vs ${b.revid}`);

const occorrenze = righeTT.filter((t) => t === 'DranSword 3-60F').length;
check('il parser non ripete un prodotto ri-elencato nei Limited Releases', occorrenze === 1, `occorrenze: ${occorrenze}`);

const dupCanonici = canonici.length !== new Set(canonici).size;
check('la canonicalizzazione non lascia due titoli per la stessa pagina', !dupCanonici);

// C10/C11 — merge su una COPIA del master: alias e idempotenza.
const masterCopia = join(WORK, 'parts-master.json');
copyFileSync(join(DATA, 'parts-master.json'), masterCopia);
const mergeTmp = join(WORK, 'merge-tmp');
mkdirSync(mergeTmp, { recursive: true });

const masterOrig = JSON.parse(readFileSync(masterCopia, 'utf8'));
// Una parte il cui alias NON coincide con tt/hasbro/id: e' il caso che prima creava il doppione.
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let vittima: any = null, aliasScelto = '';
for (const cat of ['blades', 'bits', 'ratchets']) {
  for (const e of masterOrig[cat] ?? []) {
    const al = (e.aliases ?? []).find((x: any) =>
      norm(x.value) !== norm(e.names?.tt) && norm(x.value) !== norm(e.names?.hasbro ?? '') && norm(x.value) !== norm(e.id));
    if (al) { vittima = { ...e, _cat: cat === 'blades' ? 'blade' : cat === 'bits' ? 'bit' : 'ratchet' }; aliasScelto = al.value; break; }
  }
  if (vittima) break;
}
if (vittima) {
  const conta = (m: any) => ['blades', 'lockChips', 'mainBlades', 'assistBlades', 'overBlades', 'ratchets', 'bits']
    .reduce((n, c) => n + (m[c]?.length ?? 0), 0);
  writeFileSync(join(mergeTmp, 'parts-extract-batch-test.json'), JSON.stringify([{
    category: vittima._cat, tt: aliasScelto, fromProduct: 'Test', fromUrl: 'https://example.invalid/test',
  }], null, 2));
  const m1 = tsx(['scripts/merge-master.ts', '--master', masterCopia, '--tmp', mergeTmp, '--conflicts', join(WORK, 'conflicts.json')]);
  const dopo1 = JSON.parse(readFileSync(masterCopia, 'utf8'));
  check(`un record col solo alias "${aliasScelto}" arricchisce invece di creare un doppione`,
    m1.code === 0 && /0 parti nuove/.test(m1.out) && conta(dopo1) === conta(masterOrig),
    `${conta(masterOrig)} -> ${conta(dopo1)} | ${m1.out.split('\n').find((l) => l.includes('Merge completato')) ?? m1.out.slice(-200)}`);

  const testo1 = readFileSync(masterCopia, 'utf8');
  tsx(['scripts/merge-master.ts', '--master', masterCopia, '--tmp', mergeTmp, '--conflicts', join(WORK, 'conflicts.json')]);
  check('rieseguire il merge non cambia nulla (idempotente)', readFileSync(masterCopia, 'utf8') === testo1);
} else {
  check('trovata una parte con alias distinto per il test anti-doppione', false, 'nessuna candidata nel master');
}

// C-rinomini — un nome che il wiki redirige a una parte esistente non deve creare un doppione.
// E' il caso reale del 14/08/2026: "Spinosaurus" e' come Hasbro chiama Roar Tyranno nel set
// Jurassic World, e senza questo passo il merge avrebbe creato una seconda blade.
{
  const rinTmp = join(WORK, 'rinomini');
  mkdirSync(rinTmp, { recursive: true });
  writeFileSync(join(rinTmp, 'parts-extract-batch-rinomino.json'), JSON.stringify([{
    category: 'blade', tt: 'Spinosaurus', fromProduct: 'Spinosaurus 3-85A',
    fromUrl: 'https://beyblade.fandom.com/wiki/Spinosaurus_3-85A', productCodes: ['G1899'],
  }], null, 1));
  const rr = tsx(['scripts/resolve-new-parts.ts', '--tmp', rinTmp, '--master', join(DATA, 'parts-master.json')]);
  const dopo = JSON.parse(readFileSync(join(rinTmp, 'parts-extract-batch-rinomino.json'), 'utf8'));
  check('un nome-rinomino Hasbro viene ricondotto alla parte esistente prima del merge',
    rr.code === 0 && dopo[0]?.tt === 'Roar Tyranno' && dopo[0]?.aliasDa === 'Spinosaurus',
    `tt dopo: ${JSON.stringify(dopo[0]?.tt)} | ${rr.out.split('\n').slice(-4).join(' ')}`);

  // Codici prodotto: sul wiki ProductCode e' un campo libero ("G0290 (Hasbro)<br>BX-00 (Takara
  // Tomy)"). Copiato di peso finisce dentro products[] e non ne esce piu'.
  const codTmp = join(WORK, 'codici');
  mkdirSync(codTmp, { recursive: true });
  const masterCod = join(WORK, 'master-codici.json');
  copyFileSync(join(DATA, 'parts-master.json'), masterCod);
  const cavia = JSON.parse(readFileSync(masterCod, 'utf8')).blades[0];
  writeFileSync(join(codTmp, 'parts-extract-batch-codici.json'), JSON.stringify([{
    category: 'blade', tt: cavia.names.tt, fromProduct: 'Test', fromUrl: 'https://example.invalid/t',
    productCodes: ['G0290 (Hasbro)<br>BX-00 (Takara Tomy)'],
  }], null, 1));
  tsx(['scripts/merge-master.ts', '--master', masterCod, '--tmp', codTmp, '--conflicts', join(WORK, 'c2.json')]);
  const dopoCod = JSON.parse(readFileSync(masterCod, 'utf8')).blades.find((b: any) => b.id === cavia.id);
  const malformati = (dopoCod.products ?? []).filter((p: string) => !/^(?:BX|UX|CX|BXG)-\d+\w*$|^[A-Z]\d{3,4}$/i.test(p));
  check('un ProductCode grezzo col <br> viene spezzato in codici puliti',
    malformati.length === 0 && dopoCod.products.includes('G0290') && dopoCod.products.includes('BX-00'),
    `products: ${JSON.stringify(dopoCod.products)}`);
}

// C-conflitti — un'ambiguita' non risolta deve sopravvivere a un run che non ripassa da quella
// pagina. Prima il file veniva rigenerato da zero ogni volta: le 8 ambiguita' di tipo note
// sparivano appena un giro non le riattraversava, e il file sembrava a posto proprio perche' era
// vuoto.
{
  const cTmp = join(WORK, 'conflitti');
  mkdirSync(cTmp, { recursive: true });
  const masterC = join(WORK, 'master-conflitti.json');
  copyFileSync(join(DATA, 'parts-master.json'), masterC);
  const fileC = join(WORK, 'conflitti.json');

  // Run 1: un record col type sbagliato su una parte che ne ha gia' uno -> conflitto.
  const conTipo = JSON.parse(readFileSync(masterC, 'utf8')).blades.find((b: any) => b.type);
  const altro = conTipo.type === 'attack' ? 'defense' : 'attack';
  writeFileSync(join(cTmp, 'parts-extract-batch-c1.json'), JSON.stringify([{
    category: 'blade', tt: conTipo.names.tt, type: altro,
    fromProduct: 'Test', fromUrl: 'https://example.invalid/t',
  }], null, 1));
  tsx(['scripts/merge-master.ts', '--master', masterC, '--tmp', cTmp, '--conflicts', fileC]);
  const dopo1 = JSON.parse(readFileSync(fileC, 'utf8'));
  check('un type discordante viene registrato come conflitto',
    dopo1.conflicts.some((c: any) => c.id === conTipo.id && c.type === 'type_mismatch'),
    JSON.stringify(dopo1.conflicts?.slice(0, 2)));

  // Run 2: un batch che NON parla di quella parte. Il conflitto deve restare.
  writeFileSync(join(cTmp, 'parts-extract-batch-c1.json'), JSON.stringify([{
    category: 'blade', tt: conTipo.names.tt, fromProduct: 'Test2', fromUrl: 'https://example.invalid/t2',
  }], null, 1));
  tsx(['scripts/merge-master.ts', '--master', masterC, '--tmp', cTmp, '--conflicts', fileC]);
  const dopo2 = JSON.parse(readFileSync(fileC, 'utf8'));
  check('il conflitto sopravvive a un run che non lo incontra',
    dopo2.conflicts.some((c: any) => c.id === conTipo.id && c.type === 'type_mismatch'),
    `count dopo: ${dopo2.count}`);

  // Run 3: lo stesso conflitto rivisto aggiorna la data, non si duplica.
  writeFileSync(join(cTmp, 'parts-extract-batch-c1.json'), JSON.stringify([{
    category: 'blade', tt: conTipo.names.tt, type: altro,
    fromProduct: 'Test', fromUrl: 'https://example.invalid/t',
  }], null, 1));
  tsx(['scripts/merge-master.ts', '--master', masterC, '--tmp', cTmp, '--conflicts', fileC]);
  const dopo3 = JSON.parse(readFileSync(fileC, 'utf8'));
  const quanti = dopo3.conflicts.filter((c: any) => c.id === conTipo.id && c.type === 'type_mismatch').length;
  check('rivedere lo stesso conflitto non lo duplica', quanti === 1, `occorrenze: ${quanti}`);
}

// C12 — la migrazione non lascia collisioni.
if (haStato) {
  const chiavi = Object.keys(stato.pages);
  check('nessuna chiave in formato URL o api.php nello stato', !chiavi.some((k) => k.includes('http') || k.includes('api.php')));
  check('nessun timestamp non-ISO nello stato',
    !Object.values(stato.pages).some((p: any) => p.timestamp && !/^\d{4}-\d\d-\d\dT/.test(p.timestamp)));
  const perCanon = new Map<string, string[]>();
  for (const k of chiavi) {
    const n = norm(k);
    perCanon.set(n, [...(perCanon.get(n) ?? []), k]);
  }
  const collisioni = [...perCanon.values()].filter((v) => v.length > 1);
  check('nessuna coppia di chiavi che designa la stessa pagina', collisioni.length === 0, JSON.stringify(collisioni.slice(0, 3)));
}

// ------------------------------------------------------------------ D. preservazione
titolo('D. Le parti vecchie non si perdono');

const partsCopia = join(WORK, 'parts.json');
copyFileSync(join(DATA, 'parts.json'), partsCopia);
const vp0 = tsx(['scripts/verify-parts-preserved.ts', '--current', partsCopia]);
check('con parts.json integro la verifica passa', vp0.code === 0, vp0.out.slice(-300));

const mutilato = JSON.parse(readFileSync(partsCopia, 'utf8'));
const idTolto = mutilato.blades?.[0]?.id;
mutilato.blades = (mutilato.blades ?? []).slice(1);
writeFileSync(partsCopia, JSON.stringify(mutilato, null, 2));
const vp1 = tsx(['scripts/verify-parts-preserved.ts', '--current', partsCopia]);
check(`togliere la parte "${idTolto}" fa fallire la verifica`, vp1.code === 1 && vp1.out.includes(idTolto), vp1.out.slice(-300));
const vp2 = tsx(['scripts/verify-parts-preserved.ts', '--current', partsCopia, '--allow-removed', idTolto]);
check('--allow-removed permette una rimozione voluta', vp2.code === 0, vp2.out.slice(-200));

// ------------------------------------------------------------------ 0-bis. isolamento verificato
titolo('0-bis. Il database e\' rimasto identico');
const hashDopo = hashData();
for (const f of SORVEGLIATI) {
  check(`data/${f} invariato`, hashPrima[f] === hashDopo[f], `${hashPrima[f]?.slice(0, 12)} -> ${hashDopo[f]?.slice(0, 12)}`);
}

console.log(falliti === 0 ? '\nTutti i controlli superati.' : `\n${falliti} controlli falliti.`);
process.exit(falliti === 0 ? 0 : 1);
