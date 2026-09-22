/**
 * build-products-wiki.ts — Catalogo prodotti generato dalle pagine-prodotto della Fandom Wiki.
 *
 * Scrive data/products-wiki.json. NON tocca data/products.json, che resta la fonte del sito e
 * di scan-wiki-updates: i due cataloghi convivono finche' i numeri di test-products-wiki.ts non
 * dicono che il generato copre quello curato a mano.
 *
 * ## Perche' esiste
 *
 * data/products.json e' fermo: ultimo commit 14/08/2026, nessuno script lo scrive. Intanto
 * parts-master.json si aggiorna ogni giorno e nomina 206 codici prodotto, 49 dei quali non
 * stanno nel catalogo (CX-17, CX-18, CX-19, BX-49, BX-52, UX-19, UX-20, UX-21...). Un prodotto
 * che non sta nel catalogo non finisce in releases.json, e a valle bbxdealmonitor non ne conosce
 * il listino: il 22/09/2026 un CX-17 a 85 EUR, 9,6 volte il suo listino di 8,85 EUR, e' passato
 * dal filtro prezzo perche' il filtro non aveva un listino da confrontare.
 *
 * ## Da dove viene il dato
 *
 * Ogni prodotto ha la sua pagina wiki, e l'infobox dichiara i codici ufficiali dei DUE
 * produttori sulla stessa riga:
 *
 *     |ProductCode=BX-03 (Takara Tomy)<br>F9582 (Hasbro)
 *
 * E' l'unico posto in cui la corrispondenza Takara Tomy <-> Hasbro e' SCRITTA invece che dedotta
 * dai nomi, che per questo dominio sono deboli: Hasbro traduce ("Fortress Knight" per "Armor
 * Knight"), inverte l'ordine ("Delta Unicorn" per "UnicornDelta") e a volte cambia una parola.
 * La pagina canonica porta anche i redirect dai titoli Hasbro, che sono una SECONDA fonte
 * indipendente dello stesso fatto: il verificatore le confronta.
 *
 * ## Tre principi, tutti pagati almeno una volta in questo repo
 *
 *  - **Deterministico, niente IA.** L'infobox e' una struttura, non prosa. Il file si rigenera
 *    e si committa ogni giorno: il diff deve essere solo cio' che e' cambiato sul wiki, o
 *    diventa rumore e nessuno si accorge del giorno in cui il catalogo perde quaranta prodotti.
 *  - **Mai un valore inventato.** Cio' che non si risolve va in `unresolved` col motivo e il
 *    campo resta null. La sigla W di CerberusFlame W5-80WB indovinata come "Wall" invece che
 *    "Wheel" e' costata 111 combo su una parte inesistente (repair-wall-wheel.ts). Qui il danno
 *    sarebbe piu' silenzioso: un listino sbagliato non fa fallire niente, manda solo una
 *    notifica sbagliata. Un null invece si vede.
 *  - **`unresolved` si accumula fra i run**, come parts-master-conflicts.json: il generatore
 *    riguarda una pagina solo quando cambia il revid, quindi un caso rigenerato da zero
 *    sparirebbe il giorno dopo e per sempre.
 *
 * Esegui: npm run build:products-wiki
 * Opzioni: --offline (solo cache, nessuna rete)  --limite N (prime N pagine, per provare)
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { batchQuery, fetchWikitextAtRev, writeJsonAtomic, readJson, titleToUrl, today } from './lib/wiki';
import {
  parseInfobox, campo, haCampo, pulisciValore, pezziBr, parteCommentata,
  sezione, sottosezioni, vociElenco, type Infobox,
} from './lib/wiki-infobox';
import { pulisciCellaData, estraiDataPiuAntica, normalizzaNome, classifyKind } from './scan-wiki-updates';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const OUT_PATH = join(DATA, 'products-wiki.json');

/**
 * Versione delle REGOLE di parsing, non del formato. Alzarla invalida tutta la cache e rilegge
 * le 315 pagine: serve perche' cio' che sta in cache e' il RISULTATO del parsing, e se il
 * parser migliora nessun revid della wiki lo segnala.
 */
const PARSER_VERSION = 2;

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const LIMITE = (() => {
  const i = argv.indexOf('--limite');
  return i >= 0 && argv[i + 1] ? parseInt(argv[i + 1], 10) : 0;
})();

// ---------------------------------------------------------------- tipi

export type Produttore = 'tt' | 'hasbro';
type Categoria = 'blade' | 'lockChip' | 'mainBlade' | 'assistBlade' | 'overBlade' | 'ratchet' | 'bit';

interface Rilascio {
  manufacturer: Produttore;
  code: string;
  /** Numero d'ordine dentro un Random Booster ("01", "02, 05, 06"). */
  variant: string | null;
  /** "Starter", "Booster", "Infinity Starter Pack". */
  tipo: string | null;
  /** Annotazione della riga: colore, versione, "CX-17 01 model". */
  nota: string | null;
  /** Titolo del set che lo contiene, dal [[link]] della riga. */
  dentro: string | null;
}

interface Prezzi {
  JPY: number | null; USD: number | null; CAD: number | null; GBP: number | null; AUD: number | null; EUR: number | null;
}

interface Bey {
  id: string;
  page: { title: string; revid: number; url: string; redirects: string[] };
  codes: { tt: string | null; hasbro: string | null };
  codesAnnunciati: { tt: string[]; hasbro: string[] };
  names: {
    tt: string; hasbro: string | null; hasbroDaRedirect: string | null;
    ja: string | null; romaji: string | null; letture: string[];
    altri: { valore: string; fonte: string }[];
  };
  system: string | null; system2: string | null; beyType: string | null;
  spinDirection: string | null; series: string | null;
  parts: Record<Categoria, string | null>;
  partsRaw: Record<string, string>;
  release: Record<string, string | null>;
  price: Prezzi;
  releases: Rilascio[];
  flags: string[];
}

interface Contenitore {
  id: string;
  page: { title: string; revid: number; url: string; redirects: string[] };
  kind: string;
  codes: { tt: string | null; hasbro: string | null };
  codesAnnunciati: { tt: string[]; hasbro: string[] };
  names: { tt: string; hasbro: string | null; ja: string | null; romaji: string | null };
  productType: string | null; system: string | null; series: string | null;
  release: Record<string, string | null>;
  price: Prezzi;
  /** Voci di ==Contents== / ==Assortment==: titolo linkato, variante e nota. */
  contenuto: { titolo: string; variant: string | null; nota: string | null }[];
  flags: string[];
}

interface Prodotto {
  id: string;
  code: string;
  manufacturer: Produttore;
  codePlaceholder?: true;
  owner: { page: string; revid: number } | null;
  productType: string | null;
  names: { tt: string | null; hasbro: string | null; ja: string | null; romaji: string | null };
  series: string | null;
  release: Record<string, string | null>;
  listino: { amount: number; currency: string; fonte: string } | null;
  /** Cosa c'e' dentro la confezione. Non solo bey: un Deck Set porta anche lancianti e arene,
   * e chiamarli "beys" farebbe scrivere a valle codice che li tratta per quello che non sono.
   * `kind` viene dalla classificazione della pagina contenuta. */
  contiene: { titolo: string; kind: string; variant: string | null; nota: string | null }[];
  flags: string[];
}

interface Irrisolto {
  chiave: string; tipo: string; pagina: string; revid: number | null;
  campo?: string; valore?: string; nota?: string;
  primaVisto: string; ultimoVisto: string;
}

interface PaginaVista {
  revid: number; kind: string; redirects: string[];
  resa: 'bey' | 'contenitore' | 'nessuna';
  parserVersion: number;
}

interface FileUscita {
  version: string; parserVersion: number; generated: string;
  fonte: Record<string, unknown>;
  pagine: Record<string, PaginaVista>;
  beys: Bey[];
  contenitori: Contenitore[];
  products: Prodotto[];
  unresolved: Irrisolto[];
  stats: Record<string, unknown>;
}

// ---------------------------------------------------------------- irrisolti

const OGGI = today();
const irrisolti = new Map<string, Irrisolto>();
/** Pagine riprocessate in questo run: le loro voci vecchie vanno sostituite, non accumulate. */
const paginePassate = new Set<string>();

/**
 * Irrisolti che NON si accumulano fra i run.
 *
 * L'accumulo serve a cio' che nasce leggendo una pagina: quella pagina si rilegge solo quando
 * cambia il revid, e un caso rigenerato da zero sparirebbe il giorno dopo senza essere stato
 * risolto (e' il conto gia' pagato da merge-master.ts con parts-master-conflicts.json).
 * I conflitti fra codici invece nascono dalla derivazione, che si rifa' INTERA a ogni run:
 * accumularli li renderebbe immortali, visto che nessun run successivo puo' smentirli.
 */
const TIPI_DERIVAZIONE = new Set(['codice_conteso', 'codice_solo_nelle_parti']);

/** Chiavi segnalate in QUESTO run. Non basta guardare `ultimoVisto`: due run nello stesso
 * giorno lo hanno entrambi a oggi, e le voci del primo sopravviverebbero al secondo anche
 * dopo essere state risolte — visto succedere correggendo la derivazione dei prodotti. */
const segnalatiOra = new Set<string>();

function segnala(tipo: string, pagina: string, revid: number | null, dettagli: { campo?: string; valore?: string; nota?: string } = {}): void {
  const chiave = [tipo, pagina, dettagli.campo ?? '', dettagli.valore ?? ''].join('|');
  const prima = irrisolti.get(chiave);
  segnalatiOra.add(chiave);
  irrisolti.set(chiave, {
    chiave, tipo, pagina, revid, ...dettagli,
    primaVisto: prima?.primaVisto ?? OGGI,
    ultimoVisto: OGGI,
  });
}

// ---------------------------------------------------------------- codici

const RE_TT = /^(?:BX|UX|CX|BXG)-\d+\w*$/i;
/** Piu' stretto di quello di merge-master (`^[A-Z]\d{3,4}$`): tutti i codici Hasbro osservati
 * hanno forma F#### o G####, e una lettera qualsiasi accetterebbe sigle di colore e altro. */
const RE_HASBRO = /^[FG]\d{4}$/i;

function produttoreDalCodice(c: string): Produttore | null {
  if (RE_TT.test(c)) return 'tt';
  if (RE_HASBRO.test(c)) return 'hasbro';
  return null;
}

function produttoreDallaNota(nota: string | null): Produttore | null {
  if (!nota) return null;
  if (/takara|tomy/i.test(nota)) return 'tt';
  if (/hasbro/i.test(nota)) return 'hasbro';
  return null;
}

/** Codice segnaposto: i jolly delle riedizioni, dei premi di torneo e dei Limited Releases.
 * BX-00/UX-00/CX-00 dal lato Takara Tomy, G0000 da quello Hasbro (il catalogo curato a mano lo
 * usa per Savage Bear 5-60F). Non identificano un prodotto: due "BX-00" sono due cose diverse.
 * pickFirstSet di merge-master scarta i -00 per la stessa ragione. */
function isPlaceholder(code: string): boolean {
  return /-0+$/.test(code) || /^[FG]0+$/i.test(code);
}

interface CodiciLetti {
  codes: Record<Produttore, string[]>;
  annunciati: Record<Produttore, string[]>;
}

/**
 * Codici del campo ProductCode, con l'attribuzione conservata.
 *
 * Non si riusa `normCodes` di merge-master.ts: spezza sugli stessi separatori ma fa
 * `.replace(/\([^)]*\)/g,'')` prima di validare, cioe' cancella proprio il "(Hasbro)" che qui
 * e' il dato piu' prezioso. A merge-master l'attribuzione non serviva, accumula `products[]`
 * per parte senza distinguere il produttore; a noi serve, ed e' tutto il punto del file.
 *
 * Quando l'annotazione contraddice la forma del codice non si sceglie: il codice non viene
 * attribuito e il caso va in `unresolved`.
 */
export function parseProductCode(raw: string, pagina: string, revid: number | null): CodiciLetti {
  const out: CodiciLetti = { codes: { tt: [], hasbro: [] }, annunciati: { tt: [], hasbro: [] } };
  const leggi = (testo: string, dove: 'codes' | 'annunciati') => {
    for (const pezzo of pezziBr(testo)) {
      for (const parte of pezzo.testo.split(/[,;/]/)) {
        const c = parte.trim().toUpperCase();
        if (!c || /^TBA$|^N\/A$/i.test(c)) continue; // "TBA" e' un non-codice dichiarato
        const perForma = produttoreDalCodice(c);
        const perNota = produttoreDallaNota(pezzo.nota);
        if (!perForma) {
          if (dove === 'codes') segnala('codice_non_riconosciuto', pagina, revid, { campo: 'ProductCode', valore: c });
          continue;
        }
        if (perNota && perNota !== perForma) {
          segnala('codice_produttore_discorde', pagina, revid, {
            campo: 'ProductCode', valore: c, nota: `annotazione "${pezzo.nota}" contro la forma del codice`,
          });
          continue;
        }
        if (!out[dove][perForma].includes(c)) out[dove][perForma].push(c);
      }
    }
  };
  leggi(raw.replace(/<!--[\s\S]*?-->/g, ' '), 'codes');
  const commentato = parteCommentata(raw);
  if (commentato) leggi(commentato, 'annunciati');
  return out;
}

// ---------------------------------------------------------------- prezzi

const VALUTE: [RegExp, keyof Prezzi][] = [
  [/(\d[\d,]*)\s*円/, 'JPY'],
  [/USD\s*\$\s*(\d+(?:\.\d+)?)/i, 'USD'],
  [/CAD\s*\$\s*(\d+(?:\.\d+)?)/i, 'CAD'],
  [/AUD\s*\$\s*(\d+(?:\.\d+)?)/i, 'AUD'],
  [/£\s*(\d+(?:\.\d+)?)/, 'GBP'],
  [/€\s*(\d+(?:\.\d+)?)/, 'EUR'],
];

/**
 * Prezzi per valuta dal campo Price.
 *
 * L'attribuzione e' PER VALUTA, non per posizione: il campo mette piu' valute su <br>
 * ("1980円<br>USD$9.99<br>CAD$16.99"), ma su AeroPegasus 3-70A e' "1600円 (Red Version)", cioe'
 * un prezzo solo con un'annotazione. Contare le righe sbaglierebbe su meta' delle pagine.
 */
export function parsePrezzo(raw: string | null, pagina: string, revid: number | null): Prezzi {
  const p: Prezzi = { JPY: null, USD: null, CAD: null, GBP: null, AUD: null, EUR: null };
  if (!raw) return p;
  const testo = pulisciValore(raw.replace(/<!--[\s\S]*?-->/g, ' ')); // <!-- $TBA --> non e' un prezzo pubblicato
  // "N/A" e "TBA" sono non-prezzi DICHIARATI (ValkyrieVolt S4-70V, premio di torneo mai in
  // vendita): non hanno un prezzo, e segnalarli come irrisolti sporcherebbe l'elenco delle
  // cose da guardare con casi che non c'e' niente da guardare.
  if (!testo || /^(N\/A|TBA)$/i.test(testo)) return p;
  let trovato = false;
  for (const pezzo of testo.split(/<br\s*\/?>/i)) {
    for (const [re, valuta] of VALUTE) {
      const m = re.exec(pezzo);
      if (!m) continue;
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) continue;
      if (p[valuta] == null) p[valuta] = n; // il primo valore vince: le riedizioni vengono dopo
      trovato = true;
    }
  }
  if (!trovato) segnala('prezzo_non_parsato', pagina, revid, { campo: 'Price', valore: testo.slice(0, 80) });
  return p;
}

// ---------------------------------------------------------------- date

/**
 * Date per mercato: ogni campo che comincia per "Release" diventa una chiave (JP, US, CA, UK...).
 *
 * Si scandiscono i campi invece di elencarli: UnicornDelta PO3-60GU ha ReleaseCA, che una lista
 * scritta a mano non avrebbe previsto. Un campo vuoto vale null SENZA irrisolto ("ReleaseUS="
 * significa "non uscito li'", ed e' un fatto); un campo pieno che non produce una data vale
 * null CON irrisolto.
 *
 * Il parsing delega a estraiDataPiuAntica(pulisciCellaData(...)) di scan-wiki-updates: e' la
 * stessa regola con cui nascono le date di releases.json, e serve che sia la stessa, o il
 * confronto fra generato e liste (blocco 5 del verificatore) confronterebbe due parser invece
 * di due fonti e ogni divergenza sarebbe inconcludibile.
 */
export function parseDatePerMercato(box: Infobox, pagina: string, revid: number | null): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [chiave, valore] of box.campi) {
    if (!chiave.startsWith('release')) continue;
    const mercato = (box.nomiOriginali.get(chiave) ?? chiave).replace(/^Release/i, '').trim().toUpperCase();
    if (!mercato || mercato === 'DATE') continue;
    const grezzo = valore.trim();
    if (!grezzo) { out[mercato] = null; continue; }
    const data = estraiDataPiuAntica(pulisciCellaData(grezzo));
    out[mercato] = data;
    if (!data) segnala('data_non_parsata', pagina, revid, { campo: 'Release' + mercato, valore: grezzo.slice(0, 80) });
  }
  return out;
}

// ---------------------------------------------------------------- sezione Releases

const RE_RIGA_RELEASE = /^\s*((?:BX|UX|CX|BXG)-[\w.]+|[FG]\d{4})\s*(.*)$/i;

/**
 * Sezione ==Releases==, per sottosezione ===Takara Tomy=== / ===Hasbro===.
 *
 * Qui stanno TUTTI i codici in cui un bey e' stato venduto, non solo il primario dell'infobox:
 * WizardArrow 4-80B esce in BX-03, BX-05, BX-17, BX-53 e F9582, ed e' il motivo per cui nel
 * catalogo curato a mano compare cinque volte.
 *
 * Il produttore viene dall'INTESTAZIONE, non dalla forma del codice: cosi' e' una seconda fonte
 * indipendente da ProductCode, e il verificatore le confronta invece di fidarsi di una sola.
 */
export function parseReleases(wikitext: string, pagina: string, revid: number | null): Rilascio[] {
  const corpo = sezione(wikitext, 'Releases');
  if (!corpo) return [];
  const out: Rilascio[] = [];
  for (const s of sottosezioni(corpo)) {
    const manufacturer: Produttore | null = /takara|tomy/i.test(s.titolo) ? 'tt' : /hasbro/i.test(s.titolo) ? 'hasbro' : null;
    if (!manufacturer) continue; // altre sottosezioni (es. note): non attribuibili
    for (const voce of vociElenco(s.corpo)) {
      const m = RE_RIGA_RELEASE.exec(voce.testo);
      if (!m) continue;
      const code = m[1].toUpperCase();
      const perForma = produttoreDalCodice(code);
      if (perForma && perForma !== manufacturer) {
        segnala('codice_produttore_discorde', pagina, revid, {
          campo: 'Releases/' + s.titolo, valore: code, nota: 'sotto l\'intestazione del produttore sbagliato',
        });
        continue;
      }
      const resto = m[2].trim();
      const variante = /^(\d{2}(?:\s*,\s*\d{2})*)\b/.exec(resto);
      const nota = /\(([^()]*)\)\s*$|\(([^()]*)\)\s*-/.exec(resto);
      const dentro = voce.link.length ? voce.link[voce.link.length - 1] : null;
      out.push({
        manufacturer,
        code,
        variant: variante ? variante[1].replace(/\s+/g, ' ') : null,
        tipo: tipoDallaRiga(resto),
        nota: nota ? (nota[1] ?? nota[2] ?? '').trim() || null : null,
        dentro,
      });
    }
  }
  return out;
}

/** "Starter (yellow)" -> "Starter"; "Infinity Starter Pack (teal...)" -> "Infinity Starter Pack". */
function tipoDallaRiga(resto: string): string | null {
  const senzaNote = resto.replace(/\([^()]*\)/g, ' ').replace(/"[^"]*"/g, ' ').replace(/\s+-\s+.*$/, ' ');
  const m = /\b((?:Infinity\s+|Dual\s+|Team\s+|Multipack\s+)?(?:Starter|Booster|Deck\s+Set|Battle\s+Set|Set|Pack)(?:\s+Pack)?)\b/i.exec(senzaNote);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

// ---------------------------------------------------------------- parti

interface ParteMaster { id: string; names?: { tt?: string; hasbro?: string | null }; aliases?: { value: string }[] }

const CAMPI_PARTE: Record<Categoria, string[]> = {
  // BladeX e' la forma su quasi tutte le pagine, Blade su quelle nuove (LusterDragoon 6-60LC):
  // cercarne uno solo perde meta' del catalogo, e in silenzio.
  blade: ['BladeX', 'Blade', 'RatchetBlade'],
  lockChip: ['LockChip'],
  mainBlade: ['MainBlade', 'MetalBlade'],
  assistBlade: ['AssistBlade'],
  overBlade: ['OverBlade'],
  ratchet: ['Ratchet'],
  bit: ['Bit'],
};

const SEZIONE_MASTER: Record<Categoria, string> = {
  blade: 'blades', lockChip: 'lockChips', mainBlade: 'mainBlades',
  assistBlade: 'assistBlades', overBlade: 'overBlades', ratchet: 'ratchets', bit: 'bits',
};

class Master {
  private indice = new Map<string, Map<string, string>>();

  constructor(raw: Record<string, ParteMaster[]>) {
    for (const [cat, sezioneMaster] of Object.entries(SEZIONE_MASTER)) {
      const m = new Map<string, string>();
      for (const p of raw[sezioneMaster] ?? []) {
        // Stesse chiavi di findExisting (merge-master.ts): nome TT, nome Hasbro, id, alias.
        // Mai kebab(nome) come ripiego: un id inventato entra nel dato e non se ne va piu'.
        for (const chiave of [p.names?.tt, p.names?.hasbro, p.id, ...(p.aliases ?? []).map((a) => a.value)]) {
          if (!chiave) continue;
          const k = normalizzaNome(String(chiave));
          if (k && !m.has(k)) m.set(k, p.id);
        }
      }
      this.indice.set(cat, m);
    }
  }

  risolvi(cat: Categoria, nome: string): string | null {
    return this.indice.get(cat)?.get(normalizzaNome(nome)) ?? null;
  }
}

// ---------------------------------------------------------------- lettura di una pagina

const RE_NOTA_HASBRO = /hasbro/i;

function nomiDaAka(raw: string | null): Bey['names'] {
  const base: Bey['names'] = { tt: '', hasbro: null, hasbroDaRedirect: null, ja: null, romaji: null, letture: [], altri: [] };
  if (!raw) return base;
  for (const pezzo of pezziBr(raw)) {
    if (!pezzo.nota) { base.letture.push(pezzo.testo); continue; }
    // "(Hasbro)" secco e' il nome commerciale; "(anime, English)" e "(ToyPro)" sono altro.
    if (RE_NOTA_HASBRO.test(pezzo.nota) && !/anime|manga|game/i.test(pezzo.nota)) {
      if (!base.hasbro) base.hasbro = pezzo.testo;
      continue;
    }
    base.altri.push({ valore: pezzo.testo, fonte: pezzo.nota });
  }
  return base;
}

/** Fra i redirect di una pagina, quello che ne e' la variante Hasbro. Il criterio e' negativo
 * (non e' il titolo stesso e non ne e' una riscrittura di spaziatura) perche' i redirect non
 * dichiarano da dove vengono. */
function redirectHasbro(titolo: string, redirects: string[]): string | null {
  const n = normalizzaNome(titolo);
  return redirects.find((r) => normalizzaNome(r) !== n) ?? null;
}

function leggiPagina(
  titolo: string, revid: number, redirects: string[], kind: string, wikitext: string, master: Master,
): { bey?: Bey; contenitore?: Contenitore } {
  const box = parseInfobox(wikitext);
  if (!box) {
    segnala('infobox_assente', titolo, revid);
    return {};
  }
  const codiceRaw = campo(box, 'ProductCode') ?? '';
  const letti = parseProductCode(codiceRaw, titolo, revid);
  const primo = (p: Produttore) => letti.codes[p][0] ?? null;
  const release = parseDatePerMercato(box, titolo, revid);
  const price = parsePrezzo(campo(box, 'Price'), titolo, revid);
  const ja = pulisciValore(campo(box, 'JPName') ?? '') || null;
  const romaji = pulisciValore(campo(box, 'RomajiName') ?? '') || null;

  // Un bey si riconosce dall'avere almeno una parte dichiarata, non dal `kind` del titolo:
  // classifyKind lavora sul nome della pagina e sbaglia proprio sui casi nuovi.
  const partsRaw: Record<string, string> = {};
  const parts = {} as Record<Categoria, string | null>;
  let haParti = false;
  for (const [cat, nomiCampo] of Object.entries(CAMPI_PARTE) as [Categoria, string[]][]) {
    const grezzo = campo(box, ...nomiCampo);
    parts[cat] = null;
    if (!grezzo) continue;
    const nome = pulisciValore(grezzo);
    if (!nome) continue;
    haParti = true;
    partsRaw[nomiCampo.find((n) => haCampo(box, n)) ?? nomiCampo[0]] = nome;
    const id = master.risolvi(cat, nome);
    parts[cat] = id;
    if (!id) segnala('parte_non_risolta', titolo, revid, { campo: cat, valore: nome, nota: 'nessuna corrispondenza in parts-master (tt/hasbro/id/alias)' });
  }

  if (haParti) {
    const names = nomiDaAka(campo(box, 'AKA'));
    names.tt = titolo;
    names.ja = ja;
    names.romaji = romaji;
    names.hasbroDaRedirect = redirectHasbro(titolo, redirects);
    if (names.hasbro && names.hasbroDaRedirect && normalizzaNome(names.hasbro) !== normalizzaNome(names.hasbroDaRedirect)) {
      segnala('hasbro_nome_discorde', titolo, revid, {
        campo: 'AKA', valore: names.hasbro, nota: `il redirect dice "${names.hasbroDaRedirect}"`,
      });
    }
    return {
      bey: {
        id: titolo,
        page: { title: titolo, revid, url: titleToUrl(titolo), redirects },
        codes: { tt: primo('tt'), hasbro: primo('hasbro') },
        codesAnnunciati: letti.annunciati,
        names,
        system: pulisciValore(campo(box, 'System') ?? '') || null,
        system2: pulisciValore(campo(box, 'System2') ?? '') || null,
        beyType: (pulisciValore(campo(box, 'Type') ?? '') || null)?.toLowerCase() ?? null,
        spinDirection: pulisciValore(campo(box, 'SpinDirection') ?? '') || null,
        series: pulisciValore(campo(box, 'Series') ?? '') || null,
        parts, partsRaw, release, price,
        releases: parseReleases(wikitext, titolo, revid),
        flags: [],
      },
    };
  }

  // Nessuna parte: o e' una confezione (set, random booster, multipack, accessorio) o non e'
  // niente che ci riguardi. Senza un codice non e' nemmeno una confezione utile.
  if (!letti.codes.tt.length && !letti.codes.hasbro.length) {
    if (kind === 'product') segnala('campi_parte_assenti', titolo, revid, { nota: `template ${box.template}, nessun codice` });
    return {};
  }
  const corpoContenuti = sezione(wikitext, 'Contents', 'Assortment');
  const contenuto = corpoContenuti
    ? vociElenco(corpoContenuti)
        .filter((v) => v.link.length)
        .map((v) => {
          const variante = /^(\d{2})\b/.exec(v.testo);
          const nota = /\(([^()]*)\)\s*$/.exec(v.testo);
          return { titolo: v.link[0], variant: variante ? variante[1] : null, nota: nota ? nota[1].trim() : null };
        })
    : [];
  return {
    contenitore: {
      id: titolo,
      page: { title: titolo, revid, url: titleToUrl(titolo), redirects },
      kind,
      codes: { tt: primo('tt'), hasbro: primo('hasbro') },
      codesAnnunciati: letti.annunciati,
      names: { tt: titolo, hasbro: redirectHasbro(titolo, redirects), ja, romaji },
      productType: pulisciValore(campo(box, 'ProductType') ?? '') || null,
      system: pulisciValore(campo(box, 'System') ?? '') || null,
      series: pulisciValore(campo(box, 'Series') ?? '') || null,
      release, price, contenuto, flags: [],
    },
  };
}

// ---------------------------------------------------------------- derivazione dei prodotti

/** Tutti i nomi sotto cui una pagina puo' comparire in una lista: titolo, nome Hasbro e i
 * redirect assorbiti. La lista Hasbro scrive "Sword Dran 3-60F" dove la pagina si chiama
 * "DranSword 3-60F": confrontare il solo titolo farebbe fallire l'arbitro su meta' dei casi. */
function nomiDi(x: Contenitore | Bey): string[] {
  const base = [x.id, x.names.hasbro, ...x.page.redirects];
  if ('hasbroDaRedirect' in x.names) base.push(x.names.hasbroDaRedirect);
  return base.filter((s): s is string => Boolean(s));
}

const MERCATO_DI: Record<Produttore, string[]> = { tt: ['JP'], hasbro: ['US', 'CA', 'UK', 'AU', 'EU'] };
const VALUTA_DI: Record<Produttore, (keyof Prezzi)[]> = { tt: ['JPY'], hasbro: ['USD', 'CAD', 'GBP', 'AUD', 'EUR'] };

function primaData(release: Record<string, string | null>, mercati: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const m of mercati) if (m in release) out[m] = release[m];
  return out;
}

function listinoDa(price: Prezzi, p: Produttore, fonte: string): Prodotto['listino'] {
  for (const v of VALUTA_DI[p]) {
    const n = price[v];
    if (n != null) return { amount: n, currency: v, fonte };
  }
  return null;
}

/**
 * Da bey e contenitori ai prodotti, uno per (produttore, codice).
 *
 * Un prodotto e' POSSEDUTO dalla pagina il cui ProductCode dichiara quel codice: per CX-17 e'
 * "Random Booster Vol. 10", per BX-52 la pagina-bey stessa. Un codice che compare solo dentro
 * ==Releases== crea un prodotto senza owner, e in quel caso NON si prendono data e prezzo
 * dall'infobox del bey: il "Price=1980円" di KnightShield e' il prezzo di BX-04, non di BX-53,
 * che ne costa 7480.
 */
function derivaProdotti(
  beys: Bey[], contenitori: Contenitore[], liste: Liste, kindDi: (titolo: string) => string,
): Prodotto[] {
  const perId = new Map<string, Prodotto>();
  const idDi = (p: Produttore, code: string, pagina: string) =>
    isPlaceholder(code) ? `${p}:${code}#${pagina}` : `${p}:${code}`;

  const crea = (p: Produttore, code: string, pagina: string, base: Partial<Prodotto>): Prodotto => {
    const id = idDi(p, code, pagina);
    const esistente = perId.get(id);
    if (esistente) return esistente;
    const nuovo: Prodotto = {
      id, code, manufacturer: p, owner: null, productType: null,
      names: { tt: null, hasbro: null, ja: null, romaji: null },
      series: null, release: {}, listino: null, contiene: [], flags: [],
      ...base,
    };
    if (isPlaceholder(code)) nuovo.codePlaceholder = true;
    perId.set(id, nuovo);
    return nuovo;
  };

  const aggiungi = (prod: Prodotto, titolo: string, variant: string | null, nota: string | null) => {
    if (prod.contiene.some((x) => x.titolo === titolo && x.variant === variant)) return;
    prod.contiene.push({ titolo, kind: kindDi(titolo), variant, nota });
  };

  // 1. Chi RIVENDICA ogni codice, prima di decidere chi lo possiede.
  //
  //    Il ProductCode sulla pagina di un bey non dice "questa pagina e' quel prodotto": dice
  //    "questo bey si compra li' dentro". I sei bey di un Random Booster portano tutti lo stesso
  //    CX-17, e i due di un Dual Pack lo stesso G0199. Assegnare il possesso al primo che passa
  //    e gridare al conflitto per gli altri produceva 156 falsi conflitti su 315 prodotti:
  //    era il caso normale, modellato come anomalia.
  interface Rivendicazione { p: Produttore; code: string; contenitori: Contenitore[]; beys: Bey[] }
  const rivendicazioni = new Map<string, Rivendicazione>();
  const rivendica = (p: Produttore, code: string, pagina: string): Rivendicazione => {
    const k = idDi(p, code, pagina);
    let r = rivendicazioni.get(k);
    if (!r) { r = { p, code, contenitori: [], beys: [] }; rivendicazioni.set(k, r); }
    return r;
  };
  for (const c of contenitori) {
    for (const p of ['tt', 'hasbro'] as Produttore[]) {
      if (c.codes[p]) rivendica(p, c.codes[p]!, c.id).contenitori.push(c);
    }
  }
  for (const b of beys) {
    for (const p of ['tt', 'hasbro'] as Produttore[]) {
      if (b.codes[p]) rivendica(p, b.codes[p]!, b.id).beys.push(b);
    }
  }

  // 2. Il possesso, con la lista come arbitro.
  //
  //    La regola di ripiego e' "una pagina-confezione batte una pagina-bey", perche' di norma
  //    descrive il prodotto invece di essere venduta dentro di esso. Ma non sempre: la pagina
  //    "String Launcher L" dichiara BX-34 perche' quel launcher e' incluso nel prodotto, e cosi'
  //    BX-34 finiva a 990 JPY invece dei 2321 JPY del CobaltDragoon che e'. Misurato: 80
  //    prodotti hanno un owner diverso dal bey che li rivendica, e in 2 il listino ne risultava
  //    sbagliato — abbastanza da zittire un'offerta vera a 39,90 EUR.
  //
  //    L'arbitro e' il NOME che la pagina-lista da' a quel codice: e' una terza fonte, gia'
  //    parsata, che dichiara qual e' il prodotto. Vince il pretendente uno dei cui nomi (titolo,
  //    nome Hasbro, redirect) combacia. Misurato sugli 81 prodotti con piu' pretendenti: decide
  //    in 81 casi su 81, e i 6 owner che cambia sono tutti correzioni (BX-01 dal "Winder
  //    Launcher" a "DranSword 3-60F", BX-07 dal "Launcher Grip" allo "Start Dash Set").
  //    Se l'arbitro non decide si torna al ripiego, e la scelta resta dichiarata.
  for (const riv of rivendicazioni.values()) {
    const { p, code } = riv;
    const pagina = riv.contenitori[0]?.id ?? riv.beys[0]?.id ?? code;
    const prod = crea(p, code, pagina, {});

    // L'arbitro parla solo quando c'e' una contesa: con un pretendente solo non c'e' niente da
    // decidere, e consultarlo rischierebbe di scartare l'unico che c'e' per un nome diverso.
    const pretendenti = [...riv.contenitori, ...riv.beys];
    const nomeLista = (p === 'tt' ? liste.tt.get(code) : liste.hasbro.get(code))?.name ?? null;
    let sceltoDallArbitro: Contenitore | Bey | null = null;
    if (pretendenti.length > 1 && nomeLista) {
      const target = normalizzaNome(nomeLista);
      const vincitori = pretendenti.filter((x) => nomiDi(x).some((nome) => normalizzaNome(nome) === target));
      if (vincitori.length === 1) [sceltoDallArbitro] = vincitori;
    }

    if (riv.contenitori.length > 1 && !sceltoDallArbitro) {
      // Due confezioni che rivendicano lo stesso codice, e la lista non scioglie il dubbio.
      prod.flags.push('conteso');
      for (const c of riv.contenitori.slice(1)) {
        segnala('codice_conteso', c.page.title, c.page.revid, {
          valore: code, nota: `gia' rivendicato da "${riv.contenitori[0].page.title}", e la lista non decide`,
        });
      }
    }

    // Con l'arbitro muto resta il ripiego: la confezione, o l'unico bey che rivendica. Fra piu'
    // bey soli nessuno vince — la confezione che li contiene non ha una pagina, e prendere nome
    // e prezzo da uno di loro darebbe al multipack il prezzo di uno starter.
    const scelto = sceltoDallArbitro ?? riv.contenitori[0] ?? (riv.beys.length === 1 ? riv.beys[0] : null);
    const c = scelto && 'kind' in scelto ? (scelto as Contenitore) : null;
    const b = scelto && !c ? (scelto as Bey) : null;
    if (c) {
      prod.owner = { page: c.page.title, revid: c.page.revid };
      prod.productType ??= c.productType ?? c.kind;
      prod.names = {
        tt: p === 'tt' ? c.names.tt : null,
        hasbro: p === 'hasbro' ? (c.names.hasbro ?? c.names.tt) : null,
        ja: c.names.ja, romaji: c.names.romaji,
      };
      prod.series ??= c.series;
      prod.release = primaData(c.release, MERCATO_DI[p]);
      prod.listino ??= listinoDa(c.price, p, 'infobox');
      for (const v of c.contenuto) aggiungi(prod, v.titolo, v.variant, v.nota);
    } else if (b) {
      prod.owner = { page: b.page.title, revid: b.page.revid };
      prod.names = {
        tt: p === 'tt' ? b.names.tt : null,
        // Solo l'AKA, mai il redirect: un redirect puo' essere il nome del SET in cui il bey e'
        // venduto ("Cobalt Dragoon Deluxe Left-Spin String Launcher Set" punta a CobaltDragoon
        // 2-60C), e usarlo come nome del prodotto darebbe a un booster il nome di un set.
        // Il redirect resta nel bey come controllo incrociato dell'AKA, che e' il suo scopo.
        hasbro: p === 'hasbro' ? b.names.hasbro : null,
        ja: b.names.ja, romaji: b.names.romaji,
      };
      prod.series ??= b.series;
      prod.release = primaData(b.release, MERCATO_DI[p]);
      prod.listino ??= listinoDa(b.price, p, 'infobox');
    } else {
      prod.flags.push('confezioneSenzaPagina');
    }

    for (const b of riv.beys) aggiungi(prod, b.id, null, null);
  }

  // 3. I rilasci: un bey dichiara in quali altri codici e' stato venduto.
  for (const b of beys) {
    for (const r of b.releases) {
      const prod = crea(r.manufacturer, r.code, b.id, {});
      if (!prod.owner) {
        if (!prod.flags.includes('senzaPaginaPropria')) prod.flags.push('senzaPaginaPropria');
        prod.productType ??= r.tipo;
      }
      aggiungi(prod, b.id, r.variant, r.nota);
    }
  }

  // 4. Data e listino dalle pagine-lista, SOLO dove la pagina del prodotto non li porta.
  //    Non e' un ripiego su un dato peggiore: e' l'unica fonte per i codici che non hanno una
  //    pagina propria (BX-05, BX-17: un bey venduto in piu' confezioni ha una pagina sola) e
  //    per i prezzi occidentali, che l'infobox spesso non riporta. La provenienza resta scritta
  //    nel dato, cosi' a valle si sa sempre quale fonte ha parlato.
  for (const prod of perId.values()) {
    if (prod.codePlaceholder) continue; // un -00 nelle liste e' un'altra cosa dallo stesso -00 qui
    const riga = prod.manufacturer === 'tt' ? liste.tt.get(prod.code) : liste.hasbro.get(prod.code);
    if (!riga) continue;
    if (!prod.listino && riga.listino) {
      prod.listino = { ...riga.listino, fonte: prod.manufacturer === 'tt' ? 'lista-tt' : 'lista-hasbro' };
      if (!prod.flags.includes('listinoDaLista')) prod.flags.push('listinoDaLista');
    }
    if (!Object.values(prod.release).some(Boolean) && riga.date) {
      prod.release = { [MERCATO_DI[prod.manufacturer][0]]: riga.date };
      if (!prod.flags.includes('dataDaLista')) prod.flags.push('dataDaLista');
    }
    prod.names.tt ??= prod.manufacturer === 'tt' ? riga.name : null;
    prod.names.hasbro ??= prod.manufacturer === 'hasbro' ? riga.name : null;
  }

  const out = [...perId.values()];
  for (const p of out) p.contiene.sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? '') || a.titolo.localeCompare(b.titolo));
  // Ordinamento TOTALE: con piu' righe per codice un ordinamento parziale produce diff rumorosi
  // a ogni run, e un diff rumoroso smette di essere letto.
  out.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  return out;
}

// ---------------------------------------------------------------- pagine-lista

interface RigaLista { name: string; date: string | null; listino: { amount: number; currency: string } | null }
interface Liste { tt: Map<string, RigaLista>; hasbro: Map<string, RigaLista> }

/**
 * Le due pagine-lista, gia' parsate da scan-wiki-updates in data/releases.json: `byCode` e'
 * indicizzata sul codice Takara Tomy, `byName` sul nome Hasbro ma porta il codice Hasbro nel
 * campo `productCode`. Si leggono da li' invece di riparsare le liste: sono lo stesso fatto
 * letto dallo stesso parser, e riparsarle introdurrebbe una seconda verita' sullo stesso dato.
 */
function caricaListe(): Liste {
  const rel = readJson<{
    byCode?: Record<string, RigaLista>;
    byName?: (RigaLista & { productCode?: string | null })[];
  }>(join(DATA, 'releases.json'), {});
  const tt = new Map<string, RigaLista>();
  for (const [code, r] of Object.entries(rel.byCode ?? {})) tt.set(code.toUpperCase(), r);
  const hasbro = new Map<string, RigaLista>();
  for (const r of rel.byName ?? []) if (r.productCode) hasbro.set(r.productCode.toUpperCase(), r);
  return { tt, hasbro };
}

// ---------------------------------------------------------------- inventario

/**
 * Pagine-parte, da escludere: anche loro hanno un ProductCode (Bit - Disk Ball dice "UX-03
 * (Takara Tomy)<br>G1537 (Hasbro)"), ma quello e' il prodotto in cui la parte ha DEBUTTATO,
 * non un prodotto che la pagina descrive. Includerle fa nascere prodotti col nome di un pezzo.
 *
 * "Ratchet-Integrated Blade - X" e' in piu' rispetto a classifyKind di scan-wiki-updates, che
 * cerca "Ratchet - " e non lo prende: e' bastato per far rivendicare UX-21 alla pagina della
 * parte invece che a "HellsNether Deck Set". classifyKind non si tocca perche' decide anche
 * cosa la pipeline manda all'IA, e allargarlo qui non ha effetti altrove.
 */
const RE_PAGINA_PARTE = /^(Bit|Ratchet|Ratchet-Integrated Blade|Lock Chip|Main Blade|Assist Blade|Over Blade|Metal Blade|Blade) - /i;
const LISTE = new Set([
  'List of Beyblade X products (Takara Tomy)',
  'List of Beyblade X products (Hasbro)',
]);

interface StatoWiki { pages: Record<string, { revid?: number; kind?: string; redirects?: string[] }> }

function inventario(): { titolo: string; kind: string; via: string }[] {
  const stato = readJson<StatoWiki>(join(DATA, 'wiki-scan.json'), { pages: {} });
  const out: { titolo: string; kind: string; via: string }[] = [];
  const visti = new Set<string>();
  for (const [titolo, p] of Object.entries(stato.pages ?? {})) {
    const kind = p.kind ?? classifyKind(titolo);
    // Le pagine-parte hanno anch'esse un ProductCode (Bit - Disk Ball dice "UX-03 (Takara
    // Tomy)<br>G1537 (Hasbro)"), ma quello e' il prodotto di DEBUTTO della parte, non un
    // prodotto che la pagina descrive: includerle inventerebbe prodotti dal nome sbagliato.
    if (kind === 'part' || kind === 'missing' || kind === 'meta') continue;
    if (RE_PAGINA_PARTE.test(titolo) || LISTE.has(titolo)) continue;
    visti.add(titolo);
    out.push({ titolo, kind, via: 'wiki-scan' });
  }
  // Semina dalle liste: qualche titolo di lista e' un redirect mai osservato come pagina
  // (X-treme Battlers Pack, Wide Beystadium). Costa zero fetch, entra nella stessa batchQuery.
  const rel = readJson<{ byCode?: Record<string, { name?: string }>; byName?: { name?: string }[] }>(join(DATA, 'releases.json'), {});
  for (const nome of [...Object.values(rel.byCode ?? {}).map((v) => v.name), ...(rel.byName ?? []).map((v) => v.name)]) {
    if (!nome || visti.has(nome) || RE_PAGINA_PARTE.test(nome) || LISTE.has(nome)) continue;
    visti.add(nome);
    out.push({ titolo: nome, kind: classifyKind(nome), via: 'releases' });
  }
  out.sort((a, b) => a.titolo.localeCompare(b.titolo));
  return out;
}

// ---------------------------------------------------------------- main

export async function main(): Promise<void> {
  const precedente = existsSync(OUT_PATH) ? readJson<FileUscita | null>(OUT_PATH, null) : null;
  for (const u of precedente?.unresolved ?? []) irrisolti.set(u.chiave, u);

  const master = new Master(JSON.parse(readFileSync(join(DATA, 'parts-master.json'), 'utf8').replace(/^﻿/, '')));

  let inv = inventario();
  if (LIMITE > 0) inv = inv.slice(0, LIMITE);
  console.log(`Inventario: ${inv.length} pagine (${inv.filter((p) => p.via === 'wiki-scan').length} da wiki-scan, ${inv.filter((p) => p.via === 'releases').length} seminate dalle liste).`);

  // Revid e titolo canonico in un colpo solo: batchQuery ha gia' redirects=1, quindi i titoli
  // Hasbro si risolvono da soli e il redirect assorbito e' un dato, non uno scarto. I revid NON
  // si leggono da wiki-scan.json, che puo' essere vecchio di settimane.
  const info = OFFLINE ? new Map() : await batchQuery(inv.map((p) => p.titolo));

  const pagine: Record<string, PaginaVista> = {};
  const beys: Bey[] = [];
  const contenitori: Contenitore[] = [];
  const beyPrecedenti = new Map((precedente?.beys ?? []).map((b) => [b.id, b]));
  const contPrecedenti = new Map((precedente?.contenitori ?? []).map((c) => [c.id, c]));
  const redirectsDi = new Map<string, Set<string>>();
  const canonicoDi = new Map<string, string>();

  for (const p of inv) {
    const i = info.get(p.titolo);
    const canonico = i?.canonical ?? p.titolo;
    canonicoDi.set(p.titolo, canonico);
    if (!redirectsDi.has(canonico)) redirectsDi.set(canonico, new Set());
    if (canonico !== p.titolo) redirectsDi.get(canonico)!.add(p.titolo);
    for (const r of precedente?.pagine[canonico]?.redirects ?? []) redirectsDi.get(canonico)!.add(r);
  }

  // `nonTrovate` e `fallite` sono due fatti diversi e vanno contati separati: una pagina che
  // non esiste e' un link rosso del wiki (informazione, gia' dichiarata in unresolved), un
  // fetch fallito e' un guasto nostro o di rete. Mescolarli fa suonare l'allarme del
  // verificatore per un link rosso, e lo fa tacere per un guasto quando c'e' anche un link rosso.
  let daCache = 0; let scaricate = 0; let fallite = 0; let nonTrovate = 0;
  const fatte = new Set<string>();
  for (const p of inv) {
    const canonico = canonicoDi.get(p.titolo)!;
    if (fatte.has(canonico)) continue;
    fatte.add(canonico);
    const i = info.get(p.titolo);
    const redirects = [...redirectsDi.get(canonico)!].sort();
    const visto = precedente?.pagine[canonico];
    const revid = i?.revid ?? visto?.revid ?? null;
    if (revid == null) {
      if (!OFFLINE) { nonTrovate += 1; segnala('pagina_non_trovata', canonico, null); }
      continue;
    }
    const kind = visto?.kind ?? p.kind;

    if (visto && visto.revid === revid && visto.parserVersion === PARSER_VERSION) {
      daCache += 1;
      pagine[canonico] = { ...visto, redirects };
      const b = beyPrecedenti.get(canonico);
      if (b) beys.push({ ...b, page: { ...b.page, redirects } });
      const c = contPrecedenti.get(canonico);
      if (c) contenitori.push({ ...c, page: { ...c.page, redirects } });
      continue;
    }
    if (OFFLINE) continue;

    let wikitext: string;
    try {
      wikitext = await fetchWikitextAtRev(revid);
    } catch (e) {
      fallite += 1;
      segnala('fetch_fallito', canonico, revid, { nota: (e as Error).message });
      continue;
    }
    scaricate += 1;
    paginePassate.add(canonico);
    const letto = leggiPagina(canonico, revid, redirects, kind, wikitext, master);
    if (letto.bey) beys.push(letto.bey);
    if (letto.contenitore) contenitori.push(letto.contenitore);
    pagine[canonico] = {
      revid, kind, redirects, parserVersion: PARSER_VERSION,
      resa: letto.bey ? 'bey' : letto.contenitore ? 'contenitore' : 'nessuna',
    };
  }

  beys.sort((a, b) => a.id.localeCompare(b.id));
  contenitori.sort((a, b) => a.id.localeCompare(b.id));
  const kindDi = (titolo: string) => pagine[titolo]?.kind ?? classifyKind(titolo);
  const products = derivaProdotti(beys, contenitori, caricaListe(), kindDi);

  // Copertura interna: un codice che le PARTI conoscono e che nessun prodotto porta va
  // dichiarato, o sparisce in silenzio. Sono i codici che compaiono solo nel ProductCode di una
  // pagina-parte (G1889 sta nel ratchet 9-60 e in nessuna pagina-prodotto): le pagine-parte
  // sono escluse apposta, ma "escluso apposta" e "perso" devono restare distinguibili.
  const codiciProdotti = new Set(products.map((p) => p.code.toUpperCase()));
  const masterRaw = JSON.parse(readFileSync(join(DATA, 'parts-master.json'), 'utf8').replace(/^﻿/, '')) as Record<string, { id: string; products?: string[] }[]>;
  for (const sez of Object.values(SEZIONE_MASTER)) {
    for (const parte of masterRaw[sez] ?? []) {
      for (const code of parte.products ?? []) {
        const c = String(code).toUpperCase();
        if (isPlaceholder(c) || codiciProdotti.has(c)) continue;
        segnala('codice_solo_nelle_parti', `parts-master/${sez}/${parte.id}`, null, {
          valore: c, nota: 'nessuna pagina-prodotto lo dichiara: lo cita solo l\'infobox di una pagina-parte',
        });
      }
    }
  }

  // Le voci irrisolte di una pagina riprocessata si sostituiscono (il problema puo' essere
  // stato corretto sul wiki); quelle delle pagine servite dalla cache restano come stavano.
  const unresolved = [...irrisolti.values()]
    .filter((u) => segnalatiOra.has(u.chiave) || (!paginePassate.has(u.pagina) && !TIPI_DERIVAZIONE.has(u.tipo)))
    .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.pagina.localeCompare(b.pagina) || a.chiave.localeCompare(b.chiave));

  const perTipo: Record<string, number> = {};
  for (const u of unresolved) perTipo[u.tipo] = (perTipo[u.tipo] ?? 0) + 1;
  // Coppie VERE: un BX-00 accanto a un G2736 non e' una corrispondenza fra due prodotti, perche'
  // il segnaposto non ne identifica nessuno. Contarle dava 108 invece di 80, e sarebbe stato il
  // numero con cui si giudica se questa fonte vale.
  const conEntrambi = beys.filter((b) =>
    b.codes.tt && b.codes.hasbro && !isPlaceholder(b.codes.tt) && !isPlaceholder(b.codes.hasbro)).length;

  const uscita: FileUscita = {
    version: OGGI,
    parserVersion: PARSER_VERSION,
    generated: new Date().toISOString(),
    fonte: {
      inventario: { considerate: inv.length, pagineUniche: fatte.size },
      fetch: { daCache, scaricate, fallite, nonTrovate },
    },
    pagine, beys, contenitori, products, unresolved,
    stats: {
      beys: beys.length,
      contenitori: contenitori.length,
      products: products.length,
      productsTt: products.filter((p) => p.manufacturer === 'tt').length,
      productsHasbro: products.filter((p) => p.manufacturer === 'hasbro').length,
      productsConOwner: products.filter((p) => p.owner).length,
      productsConListino: products.filter((p) => p.listino).length,
      beyConEntrambiICodici: conEntrambi,
      unresolvedPerTipo: perTipo,
    },
  };
  writeJsonAtomic(OUT_PATH, uscita);

  console.log(`Fetch: ${daCache} da cache, ${scaricate} scaricate, ${fallite} fallite, ${nonTrovate} pagine inesistenti.`);
  console.log(`Resa: ${beys.length} bey, ${contenitori.length} contenitori, ${products.length} prodotti (${uscita.stats.productsTt} tt + ${uscita.stats.productsHasbro} hasbro), ${uscita.stats.productsConListino} con listino.`);
  console.log(`Coppie TT<->Hasbro (segnaposto esclusi): ${conEntrambi}.`);
  console.log(`Irrisolti: ${unresolved.length}${unresolved.length ? ' -> ' + JSON.stringify(perTipo) : ''}`);
  console.log(`Scritto ${OUT_PATH}`);
}

const invocatoDaRiga = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (invocatoDaRiga) main().catch((e) => { console.error(e); process.exit(1); });
