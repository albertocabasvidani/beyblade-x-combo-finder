/**
 * repair-wall-wheel.ts — Riparazione una-tantum: l'assist blade "Wall" non esiste.
 *
 * Nei codici CX la lettera W in posizione assist blade sta per **Wheel**: il wiki lo scrive per
 * esteso nel campo AKA di CerberusFlame W5-80WB ("Wheel Five Eighty Wall Ball", con
 * `AssistBlade=Wheel`), e `Category:Assist Blades` elenca 19 parti fra cui Wheel e nessuna Wall.
 * Qualcuno ha letto quella W come "Wall" e ne e' nata una parte fantasma, che si e' presa la
 * sigla W mentre Wheel ripiegava su "Wh".
 *
 * Il guaio non e' cosmetico: `cx-resolve.ts` costruisce la mappa delle sigle dagli `shortName` di
 * parts.json, quindi ogni combo con la W finiva su Wall. Risultato: 111 combo su Wall, di cui 39
 * DOPPIONI esatti di altrettante combo Wheel, con le prove divise fra le due copie — la stessa
 * build contata due volte e classificata due volte, sempre piu' in basso di quanto meritasse.
 *
 * Stesso trattamento per il bit "Orbit", che non esiste sul wiki: e' "Orb".
 *
 * Cosa fa (i dati, non il codice: il resolver torna corretto da solo appena Wheel riprende la W):
 *   combos.json  fonde le doppie nella gemella Wheel, rinomina le altre, riallinea i displayName
 *   wbo-evidence.json  rimappa gli id citati
 *   parts-master.json  toglie wall/orbit, ridà a wheel la sigla W, tiene i vecchi nomi come alias
 *
 * Uso: npx tsx scripts/repair-wall-wheel.ts [--dry]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const DRY = process.argv.includes('--dry');

const leggi = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const scrivi = (f: string, v: unknown) => { if (!DRY) writeFileSync(join(DATA, f), JSON.stringify(v, null, 2) + '\n'); };

// --------------------------------------------------------------- combos.json
const doc = leggi('combos.json');
const combos: any[] = doc.combos;

/** Identita' fisica della combo, assist blade escluso: serve a riconoscere le gemelle. */
const chiave = (x: any) => [x.line ?? '', x.blade ?? '', x.lockChip ?? '', x.mainBlade ?? '',
  x.overBlade ?? '', x.ratchet ?? '', x.bit ?? ''].join('|');

const uniciPer = (arr: any[], k: (v: any) => string) => {
  const visti = new Set<string>();
  return (arr ?? []).filter((v) => { const s = k(v); if (visti.has(s)) return false; visti.add(s); return true; });
};

const perChiaveWheel = new Map<string, any>();
for (const c of combos) if (c.assistBlade === 'wheel') perChiaveWheel.set(chiave(c), c);

const daRimuovere = new Set<any>();
let fuse = 0, rinominate = 0;
const rimappaId = new Map<string, string>();

for (const c of combos) {
  if (c.assistBlade !== 'wall') continue;
  const gemella = perChiaveWheel.get(chiave(c));

  if (gemella) {
    // Fusione: le prove vanno insieme, non scelte. Dedup su JSON: un placement identico
    // arrivato per due strade e' lo stesso piazzamento, e contarlo due volte gonfia il punteggio.
    for (const t of ['placements', 'usage', 'mentions']) {
      gemella.evidence[t] = uniciPer([...(gemella.evidence?.[t] ?? []), ...(c.evidence?.[t] ?? [])], JSON.stringify);
    }
    gemella.sources = uniciPer([...(gemella.sources ?? []), ...(c.sources ?? [])],
      (s) => `${s.name}|${s.url}|${s.date}`);
    gemella.tags = [...new Set([...(gemella.tags ?? []), ...(c.tags ?? [])])];
    if (c.notes && !gemella.notes) gemella.notes = c.notes;
    if (c.dateAdded && (!gemella.dateAdded || c.dateAdded < gemella.dateAdded)) gemella.dateAdded = c.dateAdded;
    if (c.dateUpdated && (!gemella.dateUpdated || c.dateUpdated > gemella.dateUpdated)) gemella.dateUpdated = c.dateUpdated;
    rimappaId.set(c.id, gemella.id);
    daRimuovere.add(c);
    fuse++;
  } else {
    const nuovo = c.id.replace('-wall-', '-wheel-');
    rimappaId.set(c.id, nuovo);
    c.id = nuovo;
    c.assistBlade = 'wheel';
    // displayName resta com'e': usava gia' "W", che e' la sigla giusta di Wheel.
    perChiaveWheel.set(chiave(c), c);
    rinominate++;
  }
}

// Il bit "Orbit" non esiste: e' "Orb".
let orbitFatte = 0;
for (const c of combos) {
  if (c.bit !== 'orbit') continue;
  const nuovo = c.id.replace(/-orbit$/, '-orb');
  rimappaId.set(c.id, nuovo);
  c.id = nuovo;
  c.bit = 'orb';
  if (typeof c.displayName === 'string') c.displayName = c.displayName.replace(/\bOrbit\b/, 'Orb');
  orbitFatte++;
}

// Le combo Wheel gia' esistenti portano "Wh" nel nome visualizzato: ora la sigla e' W.
let nomiRiallineati = 0;
for (const c of combos) {
  if (c.assistBlade !== 'wheel' || typeof c.displayName !== 'string') continue;
  const nuovo = c.displayName.replace(/(^|\s)Wh(\s|$)/, '$1W$2');
  if (nuovo !== c.displayName) { c.displayName = nuovo; nomiRiallineati++; }
}

doc.combos = combos.filter((c) => !daRimuovere.has(c));
scrivi('combos.json', doc);

// --------------------------------------------------------------- wbo-evidence.json
// Anche qui si sostituisce nel testo: gli id compaiono sia come chiave sia nel campo "id", e
// riscrivere il file da un oggetto rischierebbe di cambiarne la forma senza motivo.
const pathEv = join(DATA, 'wbo-evidence.json');
let testo = readFileSync(pathEv, 'utf8');
let sostituiti = 0;
for (const [vecchio, nuovo] of rimappaId) {
  const parti = testo.split(`"${vecchio}"`);
  if (parti.length > 1) { sostituiti += parti.length - 1; testo = parti.join(`"${nuovo}"`); }
}
if (!DRY) writeFileSync(pathEv, testo);

// --------------------------------------------------------------- products.json
// Tre prodotti Cerberus dichiaravano assistBlade "wall": sono gli stessi che il wiki descrive con
// `AssistBlade=Wheel` (CerberusFlame W5-80WB). E la tabella delle sigle mappava "OB" su orbit:
// nessun bit "OB" esiste sul wiki, l'unico referente possibile e' Orb — la sigla si tiene, cosi'
// le fonti che la usano continuano a risolvere, ma punta alla parte vera.
// Su questo file si lavora sul TESTO, non sull'oggetto: products.json tiene le voci compatte su
// una riga sola, e ri-serializzarlo con JSON.stringify le espande tutte — 2861 righe di diff per
// tre correzioni, illeggibile per chi deve rivederlo. Le sostituzioni mirate lasciano il file
// esattamente com'era.
const pathProdotti = join(DATA, 'products.json');
let testoProdotti = readFileSync(pathProdotti, 'utf8');
const prima = testoProdotti;
testoProdotti = testoProdotti
  .split('"assistBlade": "wall"').join('"assistBlade": "wheel"')
  .split('"bit": "orbit"').join('"bit": "orb"')
  .split('"OB": "orbit"').join('"OB": "orb"');
const prodottiCorretti = (prima.match(/"assistBlade": "wall"|"bit": "orbit"/g) ?? []).length;
const sigleCorrette = (prima.match(/"OB": "orbit"/g) ?? []).length;
if (!DRY) writeFileSync(pathProdotti, testoProdotti);

// --------------------------------------------------------------- parts-master.json
const master = leggi('parts-master.json');
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const wheel = master.assistBlades.find((e: any) => e.id === 'wheel');
const orb = master.bits.find((e: any) => e.id === 'orb');
if (!wheel || !orb) throw new Error('wheel o orb assenti dal master: fermo tutto');

wheel.shortName = 'W';
// I nomi sbagliati restano come alias: le fonti della comunita' continueranno a scrivere "Wall",
// e con l'alias il merge li ricondurra' alla parte giusta invece di ricreare il fantasma.
for (const [voce, target] of [['Wall', wheel], ['Orbit', orb]] as [string, any][]) {
  target.aliases = target.aliases ?? [];
  if (!target.aliases.some((a: any) => norm(a.value) === norm(voce)))
    target.aliases.push({ value: voce, lang: 'en', kind: 'community' });
}

const primaA = master.assistBlades.length, primaB = master.bits.length;
master.assistBlades = master.assistBlades.filter((e: any) => e.id !== 'wall');
master.bits = master.bits.filter((e: any) => e.id !== 'orbit');
scrivi('parts-master.json', master);

console.log(`combos: ${fuse} fuse nella gemella, ${rinominate} rinominate, ${orbitFatte} orbit->orb, ${nomiRiallineati} displayName Wh->W`);
console.log(`combo totali: ${combos.length} -> ${doc.combos.length}`);
console.log(`wbo-evidence: ${sostituiti} id rimappati`);
console.log(`products: ${prodottiCorretti} riferimenti corretti, ${sigleCorrette} sigle rimappate`);
console.log(`master: assistBlades ${primaA}->${master.assistBlades.length}, bits ${primaB}->${master.bits.length}; wheel.shortName='W'`);
if (DRY) console.log('\n(prova: nessun file scritto)');
