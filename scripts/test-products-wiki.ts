/**
 * test-products-wiki.ts — Verifica del catalogo generato da build-products-wiki.ts.
 *
 * Non e' un test a pass/fail soltanto: il suo lavoro principale e' STAMPARE I NUMERI che
 * decidono se il catalogo generato puo' un giorno sostituire data/products.json — cosa
 * aggiunge, cosa perde, dove contraddice il catalogo curato a mano. Gli assert duri sono
 * pochi e riguardano le proprieta' che non possono essere violate in nessun caso.
 *
 * Tutto IN-PROCESS, nessun sottoprocesso: test-wiki-scan.ts lancia scan-wiki-updates con
 * execFileSync({shell:true}) e per questo non gira sulla macchina di sviluppo, dove la
 * cartella si chiama "beyblade combos" e l'argomento si tronca allo spazio. Un verificatore
 * che non gira in locale costa un giro sul server a ogni tentativo, e nessuno lo lancia.
 *
 * Esegui: npm run test:products-wiki            (verifica il file gia' generato, offline)
 *         npm run test:products-wiki -- --esegui (rigenera prima, e controlla isolamento,
 *                                                 cache e determinismo: richiede rete)
 * Esce 1 se un assert duro fallisce, 2 se il DATO ha un problema che va guardato.
 */
import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { normalizzaNome, inEuro } from './scan-wiki-updates';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const TMP = join(ROOT, 'tmp');
const OUT = join(DATA, 'products-wiki.json');
const ESEGUI = process.argv.includes('--esegui');

/** File che il generatore NON deve toccare. */
const INTOCCABILI = ['products.json', 'parts-master.json', 'releases.json', 'wiki-scan.json'];

let falliti = 0;
let daGuardare = 0;
function check(nome: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ok  ${nome}`);
  else { console.error(`  NO  ${nome} ${extra}`); falliti += 1; }
}
function titolo(s: string): void { console.log(`\n=== ${s}`); }
function nota(s: string): void { console.log(`      ${s}`); }

function leggi<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T;
}
function hashDi(path: string): string {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'ASSENTE';
}

// ------------------------------------------------------------------ tipi minimi

interface Bey {
  id: string; codes: { tt: string | null; hasbro: string | null };
  names: { tt: string; hasbro: string | null; hasbroDaRedirect: string | null };
  parts: Record<string, string | null>; partsRaw: Record<string, string>;
  release: Record<string, string | null>;
  releases: { manufacturer: string; code: string }[];
  page: { redirects: string[] };
}
interface Prodotto {
  id: string; code: string; manufacturer: 'tt' | 'hasbro'; codePlaceholder?: true;
  owner: { page: string } | null; names: Record<string, string | null>;
  release: Record<string, string | null>;
  listino: { amount: number; currency: string; fonte: string } | null;
  contiene: { titolo: string; kind: string; variant: string | null }[];
  flags: string[];
}
interface Generato {
  parserVersion: number; generated: string;
  pagine: Record<string, { revid: number; kind: string; resa: string }>;
  beys: Bey[]; contenitori: unknown[]; products: Prodotto[];
  unresolved: { tipo: string; pagina: string; campo?: string; valore?: string }[];
  stats: Record<string, unknown>;
  fonte: { fetch: { daCache: number; scaricate: number; fallite: number; nonTrovate?: number } };
}
interface VoceCatalogo {
  code: string; name: string; type?: string;
  blade?: string; lockChip?: string; mainBlade?: string; assistBlade?: string; overBlade?: string;
  ratchet?: string; bit?: string;
}

// ------------------------------------------------------------------ blocco 0

async function blocco0(): Promise<void> {
  if (!ESEGUI) {
    titolo('0 - isolamento e determinismo: saltati (serve --esegui)');
    return;
  }
  titolo('0 - isolamento, cache, determinismo');
  const prima = Object.fromEntries(INTOCCABILI.map((f) => [f, hashDi(join(DATA, f))]));
  const { main } = await import('./build-products-wiki');

  await main();
  const dopoPrimo = hashDi(OUT);
  const uno = leggi<Generato>(OUT);
  mkdirSync(TMP, { recursive: true });
  copyFileSync(OUT, join(TMP, 'products-wiki.primo.json'));

  await main();
  const due = leggi<Generato>(OUT);

  const dopo = Object.fromEntries(INTOCCABILI.map((f) => [f, hashDi(join(DATA, f))]));
  for (const f of INTOCCABILI) check(`${f} non toccato`, prima[f] === dopo[f]);

  check('nessun fetch fallito', due.fonte.fetch.fallite === 0, `(${due.fonte.fetch.fallite})`);
  nota(`pagine inesistenti sul wiki (link rossi, non guasti): ${due.fonte.fetch.nonTrovate ?? 0}`);
  check('la seconda esecuzione non scarica nulla', due.fonte.fetch.scaricate === 0,
    `(scaricate ${due.fonte.fetch.scaricate}, da cache ${due.fonte.fetch.daCache})`);

  // Determinismo: due esecuzioni devono dare lo stesso file, a meno del timestamp.
  const senzaData = (g: Generato) => JSON.stringify({ ...g, generated: '' });
  check('due esecuzioni danno lo stesso catalogo', senzaData(uno) === senzaData(due));
  nota(`hash del primo: ${dopoPrimo.slice(0, 16)}`);
}

// ------------------------------------------------------------------ helper comuni

/** Righe codice x bey del generato, nella forma piatta di products.json. */
function righeGenerato(g: Generato): { code: string; manufacturer: string; bey: string; prod: Prodotto }[] {
  const beyIds = new Set(g.beys.map((b) => b.id));
  const out: { code: string; manufacturer: string; bey: string; prod: Prodotto }[] = [];
  for (const p of g.products) {
    for (const v of p.contiene) {
      // Solo i contenuti che sono davvero bey: un Deck Set contiene anche lancianti e arene.
      if (!beyIds.has(v.titolo)) continue;
      out.push({ code: p.code, manufacturer: p.manufacturer, bey: v.titolo, prod: p });
    }
  }
  return out;
}

function vociCatalogo(): VoceCatalogo[] {
  const cat = leggi<{ products?: Record<string, Record<string, VoceCatalogo[]>> }>(join(DATA, 'products.json'));
  const out: VoceCatalogo[] = [];
  for (const categorie of Object.values(cat.products ?? {})) {
    for (const arr of Object.values(categorie)) if (Array.isArray(arr)) out.push(...arr);
  }
  return out;
}

// ------------------------------------------------------------------ blocco 1

function blocco1(g: Generato): void {
  titolo('1 - cosa e\' stato letto');
  const perResa: Record<string, number> = {};
  for (const p of Object.values(g.pagine)) perResa[p.resa] = (perResa[p.resa] ?? 0) + 1;
  nota(`pagine lette: ${Object.keys(g.pagine).length}  ${JSON.stringify(perResa)}`);
  nota(`bey ${g.beys.length} | contenitori ${g.contenitori.length} | prodotti ${g.products.length}`);
  const conListino = g.products.filter((p) => p.listino);
  const perFonte: Record<string, number> = {};
  for (const p of conListino) perFonte[p.listino!.fonte] = (perFonte[p.listino!.fonte] ?? 0) + 1;
  nota(`prodotti con listino: ${conListino.length}/${g.products.length}  per fonte ${JSON.stringify(perFonte)}`);
  check('ogni prodotto ha un codice e un produttore', g.products.every((p) => p.code && p.manufacturer));
  check('gli id dei prodotti sono unici', new Set(g.products.map((p) => p.id)).size === g.products.length);
}

// ------------------------------------------------------------------ blocco 2

function blocco2(g: Generato): void {
  titolo('2 - copertura rispetto a data/products.json');
  const catalogo = vociCatalogo();
  const codiciCat = new Set(catalogo.map((v) => String(v.code).toUpperCase()));
  const codiciGen = new Set(g.products.filter((p) => !p.codePlaceholder).map((p) => p.code.toUpperCase()));
  const catNonPlaceholder = new Set([...codiciCat].filter((c) => !isPlaceholder(c)));

  const aggiunti = [...codiciGen].filter((c) => !codiciCat.has(c)).sort();
  const persi = [...catNonPlaceholder].filter((c) => !codiciGen.has(c)).sort();
  const comuni = [...codiciGen].filter((c) => codiciCat.has(c));

  nota(`codici distinti: generato ${codiciGen.size} | catalogo ${codiciCat.size} (${catNonPlaceholder.size} senza i -00)`);
  nota(`in comune ${comuni.length} | AGGIUNTI ${aggiunti.length} | PERSI ${persi.length}`);
  console.log(`\n  AGGIUNTI (${aggiunti.length}) - codici che il catalogo non ha:`);
  for (const c of aggiunti) {
    const p = g.products.find((x) => x.code.toUpperCase() === c)!;
    console.log(`    ${c.padEnd(8)} ${(p.owner?.page ?? '(senza pagina propria)').slice(0, 38).padEnd(40)} ${p.listino ? p.listino.amount + ' ' + p.listino.currency : '-'}`);
  }
  console.log(`\n  PERSI (${persi.length}) - codici del catalogo che il generato non ha:`);
  for (const c of persi) {
    const v = catalogo.find((x) => String(x.code).toUpperCase() === c)!;
    console.log(`    ${c.padEnd(8)} ${v.name}`);
  }

  // Disaccordo sulle parti: il controllo piu' severo. products.json e' curato a mano da mesi e
  // ha gia' assorbito correzioni (Wall->Wheel, orbit->orb): se il generato lo contraddice su
  // una parte, e' il generato a doversi spiegare.
  const CATEGORIE = ['blade', 'lockChip', 'mainBlade', 'assistBlade', 'overBlade', 'ratchet', 'bit'] as const;
  const perBey = new Map(g.beys.map((b) => [b.id, b]));
  const righe = righeGenerato(g);
  let confrontate = 0;
  const disaccordi: string[] = [];
  for (const v of catalogo) {
    const code = String(v.code).toUpperCase();
    const riga = righe.find((r) => r.code.toUpperCase() === code && normalizzaNome(r.bey) === normalizzaNome(v.name));
    if (!riga) continue;
    const b = perBey.get(riga.bey)!;
    confrontate += 1;
    for (const cat of CATEGORIE) {
      const mio = b.parts[cat] ?? null;
      const suo = (v as unknown as Record<string, string | undefined>)[cat] ?? null;
      if (mio === suo) continue;
      disaccordi.push(`    ${code.padEnd(8)} ${v.name.slice(0, 28).padEnd(30)} ${cat.padEnd(12)} catalogo=${suo ?? 'null'}  generato=${mio ?? 'null'}`);
    }
  }
  console.log(`\n  righe codice x bey confrontate: ${confrontate}  (catalogo ${catalogo.length}, generato ${righe.length})`);
  console.log(`  disaccordi sulle parti: ${disaccordi.length}`);
  for (const d of disaccordi.slice(0, 40)) console.log(d);
  if (disaccordi.length > 40) console.log(`    ... e altri ${disaccordi.length - 40}`);
  if (disaccordi.length) daGuardare += 1;

  // Assert duro: nessun id parte penzolante. Stesso controllo che build-parts.ts fa su
  // products.json; il file nuovo non puo' essere piu' debole di quello vecchio.
  const master = leggi<Record<string, { id: string }[]>>(join(DATA, 'parts-master.json'));
  const idNoti = new Set<string>();
  for (const sez of ['blades', 'lockChips', 'mainBlades', 'assistBlades', 'overBlades', 'ratchets', 'bits']) {
    for (const p of master[sez] ?? []) idNoti.add(p.id);
  }
  const penzolanti = new Set<string>();
  for (const b of g.beys) for (const v of Object.values(b.parts)) if (v && !idNoti.has(v)) penzolanti.add(v);
  check('nessun id parte penzolante', penzolanti.size === 0, [...penzolanti].join(', '));
}

// ------------------------------------------------------------------ blocco 3

function blocco3(g: Generato): void {
  titolo('3 - i codici che le parti nominano e il catalogo non ha');
  // Ricalcolati qui, non copiati da un piano: l'insieme cambia quando parts-master cresce.
  const master = leggi<Record<string, { products?: string[] }[]>>(join(DATA, 'parts-master.json'));
  const daParti = new Set<string>();
  for (const sez of ['blades', 'lockChips', 'mainBlades', 'assistBlades', 'overBlades', 'ratchets', 'bits']) {
    for (const p of master[sez] ?? []) for (const c of p.products ?? []) daParti.add(String(c).toUpperCase());
  }
  const codiciCat = new Set(vociCatalogo().map((v) => String(v.code).toUpperCase()));
  const mancanti = [...daParti].filter((c) => !codiciCat.has(c) && !isPlaceholder(c)).sort();
  const codiciGen = new Set(g.products.map((p) => p.code.toUpperCase()));
  const trovati = mancanti.filter((c) => codiciGen.has(c));
  const fuori = mancanti.filter((c) => !codiciGen.has(c));

  nota(`${mancanti.length} codici citati dalle parti e assenti dal catalogo: nel generato ${trovati.length}/${mancanti.length}`);
  if (fuori.length) {
    console.log('  ancora fuori:');
    for (const c of fuori) {
      const u = g.unresolved.find((x) => x.valore === c);
      console.log(`    ${c.padEnd(8)} ${u ? u.tipo + ' su ' + u.pagina : 'nessun motivo dichiarato'}`);
    }
    // Un codice che sparisce senza motivo e' peggio di uno che manca: va dichiarato.
    check('ogni codice non trovato ha un motivo in unresolved',
      fuori.every((c) => g.unresolved.some((x) => x.valore === c)), `(${fuori.join(', ')})`);
  }
}

// ------------------------------------------------------------------ blocco 4

/** I jolly non identificano un prodotto: due "BX-00" sono due cose diverse. */
const isPlaceholder = (c: string) => /-0+$/.test(c) || /^[FG]0+$/i.test(c);

function blocco4(g: Generato): void {
  titolo('4 - coppie Takara Tomy <-> Hasbro');
  // Coppie VERE: un BX-00 accanto a un G2736 non e' una corrispondenza fra due prodotti, e
  // contarla gonfierebbe il numero che decide se questa fonte vale.
  const conEntrambi = g.beys.filter((b) =>
    b.codes.tt && b.codes.hasbro && !isPlaceholder(b.codes.tt) && !isPlaceholder(b.codes.hasbro));
  const conRedirect = g.beys.filter((b) => b.names.hasbroDaRedirect);
  nota(`bey con entrambi i codici: ${conEntrambi.length} | bey con un redirect: ${conRedirect.length}`);

  // Controllo a campione automatizzato su TUTTE le coppie: names.hasbro viene dal campo AKA
  // dell'infobox, names.hasbroDaRedirect dal titolo del redirect. Sono due fatti scritti da
  // redattori diversi in punti diversi della wiki, ed e' una prova piu' forte di dieci
  // ispezioni a mano.
  const conDue = g.beys.filter((b) => b.names.hasbro && b.names.hasbroDaRedirect);
  const concordi = conDue.filter((b) => normalizzaNome(b.names.hasbro!) === normalizzaNome(b.names.hasbroDaRedirect!));
  nota(`nome Hasbro confrontabile su due fonti: ${conDue.length} | concordi ${concordi.length} | discordi ${conDue.length - concordi.length}`);
  for (const b of conDue.filter((x) => !concordi.includes(x))) {
    console.log(`    ${b.id.slice(0, 30).padEnd(32)} AKA="${b.names.hasbro}"  redirect="${b.names.hasbroDaRedirect}"`);
  }

  // Seconda fonte indipendente sul produttore: l'intestazione di ==Releases== contro la forma
  // del codice. Se divergono, uno dei due e' sbagliato e non si sceglie a caso.
  let incoerenti = 0;
  for (const b of g.beys) {
    for (const r of b.releases) {
      const perForma = /^(BX|UX|CX|BXG)-/i.test(r.code) ? 'tt' : /^[FG]\d{4}$/i.test(r.code) ? 'hasbro' : null;
      if (perForma && perForma !== r.manufacturer) incoerenti += 1;
    }
  }
  check('produttore coerente fra intestazione e forma del codice in ==Releases==', incoerenti === 0, `(${incoerenti})`);

  console.log('\n  campione, le prime 10 coppie per codice:');
  for (const b of conEntrambi.sort((x, y) => x.codes.tt!.localeCompare(y.codes.tt!)).slice(0, 10)) {
    console.log(`    ${b.codes.tt!.padEnd(7)} ${b.codes.hasbro!.padEnd(7)} ${b.names.tt.slice(0, 26).padEnd(28)} ${(b.names.hasbro ?? '-').slice(0, 26)}`);
  }
}

// ------------------------------------------------------------------ blocco 5

function blocco5(g: Generato): void {
  titolo('5 - data e listino contro le pagine-lista');
  const rel = leggi<{
    byCode?: Record<string, { date: string | null; listino: { amount: number; currency: string } | null }>;
    byName?: { productCode?: string | null; date: string | null; listino: { amount: number; currency: string } | null }[];
    products?: { code: string; manufacturer: string; listinoEur: number | null }[];
    fx?: { rates: { JPY: number; USD: number } };
  }>(join(DATA, 'releases.json'));
  const byCode = rel.byCode ?? {};
  const byHasbro = new Map((rel.byName ?? []).filter((r) => r.productCode).map((r) => [r.productCode!.toUpperCase(), r]));

  for (const [chi, prendi] of [['TT', (c: string) => byCode[c]], ['Hasbro', (c: string) => byHasbro.get(c)]] as const) {
    let dataUguale = 0; let dataDiversa = 0; let soloGen = 0; let soloLista = 0;
    let listUguale = 0; let listDiverso = 0; let altraValuta = 0;
    const divergenze: string[] = [];
    for (const p of g.products) {
      if (p.codePlaceholder) continue;
      if ((chi === 'TT') !== (p.manufacturer === 'tt')) continue;
      if (p.listino?.fonte !== 'infobox') continue; // solo dove la pagina POSSIEDE il dato
      const riga = prendi(p.code.toUpperCase());
      if (!riga) continue;
      // La PIU' ANTICA delle date della pagina, non la prima: la cella della lista mette tutti
      // i mercati in una casella e estraiDataPiuAntica ne prende la piu' vecchia, che per Hasbro
      // e' quasi sempre quella canadese. Confrontarla con ReleaseUS dava 41 falsi disaccordi
      // tutti nella stessa direzione, che e' la firma di un confronto fra due cose diverse.
      const mie = Object.values(p.release).filter(Boolean).sort() as string[];
      const mia = mie[0] ?? null;
      if (mia && riga.date) {
        if (mia === riga.date) dataUguale += 1;
        else { dataDiversa += 1; divergenze.push(`    data    ${p.code.padEnd(8)} ${(p.owner?.page ?? '').slice(0, 30).padEnd(32)} pagina=${mia}  lista=${riga.date}`); }
      } else if (mia) soloGen += 1;
      else if (riga.date) soloLista += 1;
      if (p.listino && riga.listino) {
        // Valute diverse non sono un disaccordo: la lista Hasbro porta sempre il dollaro USA,
        // l'infobox a volte solo il prezzo australiano. Convertirli qui introdurrebbe un cambio
        // nel confronto, e un confronto non deve avere parti mobili.
        if (p.listino.currency !== riga.listino.currency) altraValuta += 1;
        else if (p.listino.amount === riga.listino.amount) listUguale += 1;
        else { listDiverso += 1; divergenze.push(`    listino ${p.code.padEnd(8)} ${(p.owner?.page ?? '').slice(0, 30).padEnd(32)} pagina=${p.listino.amount} ${p.listino.currency}  lista=${riga.listino.amount} ${riga.listino.currency}`); }
      }
    }
    nota(`${chi}: data uguale ${dataUguale} | diversa ${dataDiversa} | solo pagina ${soloGen} | solo lista ${soloLista}`);
    nota(`${chi}: listino uguale ${listUguale} | diverso ${listDiverso} | valuta non confrontabile ${altraValuta}`);
    for (const d of divergenze.slice(0, 25)) console.log(d);
    if (divergenze.length > 25) console.log(`    ... e altre ${divergenze.length - 25}`);
  }

  // La riga che chiude il cerchio sul guasto del 22/09/2026.
  const inReleases = new Set((rel.products ?? []).filter((p) => p.listinoEur != null).map((p) => p.code.toUpperCase()));
  const guadagnati = g.products.filter((p) => p.listino && !p.codePlaceholder && !inReleases.has(p.code.toUpperCase()));
  console.log(`\n  codici con listino nel generato e SENZA listino in releases.json.products: ${guadagnati.length}`);
  const cx17 = guadagnati.find((p) => p.code === 'CX-17');
  const fx = rel.fx?.rates ? { rates: rel.fx.rates } : null;
  if (cx17) {
    const eur = inEuro(cx17.listino as { amount: number; currency: 'JPY' | 'USD' }, fx);
    console.log(`    CX-17  ${cx17.listino!.amount} ${cx17.listino!.currency}${eur != null ? ` (${eur} EUR)` : ''}  owner=${cx17.owner?.page ?? '-'}`);
  }
  check('CX-17 ha un listino nel generato', Boolean(cx17), '(e\' il codice del guasto del 22/09/2026)');
  for (const p of guadagnati.filter((x) => x.code !== 'CX-17').slice(0, 20)) {
    console.log(`    ${p.code.padEnd(8)} ${String(p.listino!.amount).padStart(6)} ${p.listino!.currency}  ${p.listino!.fonte.padEnd(12)} ${(p.owner?.page ?? '(senza pagina)').slice(0, 34)}`);
  }
  if (guadagnati.length > 21) console.log(`    ... e altri ${guadagnati.length - 21}`);
}

// ------------------------------------------------------------------ blocco 6

function blocco6(g: Generato): void {
  titolo('6 - non-invenzione');
  const perTipo: Record<string, number> = {};
  for (const u of g.unresolved) perTipo[u.tipo] = (perTipo[u.tipo] ?? 0) + 1;
  nota(`irrisolti: ${g.unresolved.length} ${JSON.stringify(perTipo)}`);
  for (const u of g.unresolved) {
    console.log(`    ${u.tipo.padEnd(26)} ${u.pagina.slice(0, 34).padEnd(36)} ${(u.campo ?? '')}${u.valore ? '=' + u.valore : ''}`);
  }

  // Ogni parte non risolta deve avere lasciato traccia: il nome grezzo resta in partsRaw, cosi'
  // il caso e' diagnosticabile e il null non e' un buco muto.
  const senzaTraccia = g.beys.filter((b) =>
    Object.entries(b.parts).some(([cat, v]) => v === null && Object.keys(b.partsRaw).length > 0
      && g.unresolved.some((u) => u.pagina === b.id && u.campo === cat) === false
      && Object.values(b.partsRaw).length > 0 && cat === 'blade' && b.partsRaw.BladeX !== undefined));
  check('ogni parte nulla e\' spiegata da partsRaw o da unresolved', senzaTraccia.length === 0,
    senzaTraccia.slice(0, 5).map((b) => b.id).join(', '));

  const contesi = g.products.filter((p) => p.flags.includes('conteso'));
  if (contesi.length) {
    console.log(`\n  prodotti con codice conteso da due confezioni: ${contesi.length}`);
    for (const p of contesi) console.log(`    ${p.id.padEnd(16)} owner=${p.owner?.page ?? '-'}`);
    daGuardare += 1;
  }
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  await blocco0();
  if (!existsSync(OUT)) {
    console.error(`\nManca ${OUT}: esegui prima "npm run build:products-wiki".`);
    process.exit(1);
  }
  const g = leggi<Generato>(OUT);
  console.log(`\nCatalogo generato il ${g.generated.slice(0, 19).replace('T', ' ')} (parserVersion ${g.parserVersion}).`);
  blocco1(g);
  blocco2(g);
  blocco3(g);
  blocco4(g);
  blocco5(g);
  blocco6(g);

  console.log(`\n${falliti === 0 ? 'Tutti gli assert passano.' : falliti + ' assert FALLITI.'}`);
  if (daGuardare) console.log(`${daGuardare} punti da guardare (disaccordi o codici contesi): sopra, in chiaro.`);
  if (falliti) process.exit(1);
  if (daGuardare) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
