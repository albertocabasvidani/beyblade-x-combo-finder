/**
 * lib/wiki-infobox.ts — Parser dell'infobox e delle sezioni di una pagina Fandom.
 *
 * Nasce per build-products-wiki.ts: l'infobox delle pagine-prodotto dichiara i codici
 * ufficiali dei DUE produttori sulla stessa riga ("BX-03 (Takara Tomy)<br>F9582 (Hasbro)"),
 * e quella e' l'unica fonte in cui la corrispondenza fra il prodotto Takara Tomy e il suo
 * gemello Hasbro e' scritta invece che dedotta dai nomi.
 *
 * Modulo puro: nessuna rete, nessun I/O, nessuna conoscenza del dominio Beyblade. Le regole
 * che riguardano i codici, i prezzi e le parti stanno nel generatore, non qui.
 *
 * Tre cose che si imparano solo guardando il wikitext vero (fixture in tmp/wiki_fetch/):
 *
 *  - Il template ha piu' nomi: {{Beyblade Infobox}}, {{Beyblade Set Infobox}},
 *    {{Product Infobox}}, {{Part Infobox}}. Si cerca per suffisso "Infobox", non per nome.
 *  - I valori contengono {{Ruby|3-70|スリーセブンティー}}, [[Link|etichetta]] e perfino un
 *    <gallery> multiriga (Image3 di KnightShield). Una regex non-greedy su `\}\}` chiude al
 *    primo Ruby invece che a fine template: la scansione e' a contatore di graffe.
 *  - I commenti HTML non sono rumore. "BX-52<!-- (Takara Tomy)<br>TBA (Hasbro)-->" dice che
 *    il codice Takara Tomy e' BX-52 e che la versione Hasbro non esiste ancora ma e' attesa:
 *    il visibile e il commentato vanno tenuti separati, non fusi ne' buttati.
 */

/** Un infobox letto: nome del template e campi, indicizzati per chiave normalizzata. */
export interface Infobox {
  /** Nome del template come lo scrive la pagina, es. "Beyblade Set Infobox". */
  template: string;
  /** chiave normalizzata (minuscolo, senza spazi) -> valore grezzo, com'e' sul wiki. */
  campi: Map<string, string>;
  /** chiave normalizzata -> nome del campo come lo scrive la pagina (per i report). */
  nomiOriginali: Map<string, string>;
}

/** Chiave di lookup: "Image1 " e "image1" sono lo stesso campo. */
export function normalizzaChiave(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * Taglia un corpo di template sui `|` che sono davvero separatori di campo.
 *
 * Due filtri, entrambi necessari e per motivi diversi:
 *  - profondita' zero: i `|` dentro {{Ruby|a|b}} e [[A|B]] non separano niente;
 *  - la forma `nome =`: dentro <gallery> le righe sono "file.png|Didascalia", e quel `|` sta
 *    a profondita' zero. Un campo dell'infobox pero' ha sempre la forma `|Nome=`, e una
 *    didascalia no. Senza questo secondo filtro l'Image3 di KnightShield si spezza in tre.
 */
function tagliaCampi(corpo: string): string[] {
  const pezzi: string[] = [];
  let ultimo = 0;
  let graffe = 0;
  let quadre = 0;
  for (let i = 0; i < corpo.length; i += 1) {
    if (corpo.startsWith('{{', i)) { graffe += 1; i += 1; continue; }
    if (corpo.startsWith('}}', i)) { graffe -= 1; i += 1; continue; }
    if (corpo.startsWith('[[', i)) { quadre += 1; i += 1; continue; }
    if (corpo.startsWith(']]', i)) { quadre -= 1; i += 1; continue; }
    if (corpo[i] !== '|' || graffe > 0 || quadre > 0) continue;
    if (!/^\s*[A-Za-z][A-Za-z0-9 _-]*\s*=/.test(corpo.slice(i + 1, i + 60))) continue;
    pezzi.push(corpo.slice(ultimo, i));
    ultimo = i + 1;
  }
  pezzi.push(corpo.slice(ultimo));
  return pezzi;
}

/**
 * Primo template il cui nome finisce per "Infobox". null se la pagina non ne ha (capita: i
 * redirect, le pagine di disambiguazione, qualche accessorio scritto a mano).
 */
export function parseInfobox(wikitext: string): Infobox | null {
  const apertura = /\{\{\s*([^}|\n]*Infobox)\s*(?=[|\n}])/i.exec(wikitext);
  if (!apertura) return null;

  // Scansione a contatore dal '{{' di apertura fino alla graffa che lo bilancia.
  let profondita = 0;
  let fine = -1;
  for (let i = apertura.index; i < wikitext.length; i += 1) {
    if (wikitext.startsWith('{{', i)) { profondita += 1; i += 1; continue; }
    if (wikitext.startsWith('}}', i)) {
      profondita -= 1;
      if (profondita === 0) { fine = i; break; }
      i += 1;
    }
  }
  if (fine < 0) return null; // template non chiuso: pagina rotta, meglio dirlo che indovinare

  const corpo = wikitext.slice(apertura.index + 2, fine);
  const pezzi = tagliaCampi(corpo);
  const campi = new Map<string, string>();
  const nomiOriginali = new Map<string, string>();
  // pezzi[0] e' il nome del template, gia' catturato da `apertura`.
  for (const pezzo of pezzi.slice(1)) {
    const eq = pezzo.indexOf('=');
    if (eq < 0) continue; // parametro posizionale: l'infobox non ne usa
    const nome = pezzo.slice(0, eq).trim();
    if (!nome) continue;
    const chiave = normalizzaChiave(nome);
    if (campi.has(chiave)) continue; // duplicato nella stessa pagina: vince il primo
    campi.set(chiave, pezzo.slice(eq + 1).trim());
    nomiOriginali.set(chiave, nome);
  }
  return { template: apertura[1].trim(), campi, nomiOriginali };
}

/** Primo campo presente fra quelli elencati, grezzo. I nomi si scrivono come sul wiki. */
export function campo(box: Infobox | null, ...nomi: string[]): string | null {
  if (!box) return null;
  for (const n of nomi) {
    const v = box.campi.get(normalizzaChiave(n));
    if (v != null && v !== '') return v;
  }
  return null;
}

/** true se il campo esiste nella pagina, anche vuoto. Distingue "non uscito li'" (ReleaseUS=)
 * da "la pagina non lo dice" (nessun ReleaseUS), che sono due fatti diversi. */
export function haCampo(box: Infobox | null, ...nomi: string[]): boolean {
  if (!box) return false;
  return nomi.some((n) => box.campi.has(normalizzaChiave(n)));
}

/**
 * Valore leggibile: via i commenti, i grassetti, i <ref>, i {{Ruby}} sciolti sulla base e i
 * link ridotti alla loro etichetta. I <br> restano: la struttura a righe e' informazione
 * (un <br> separa i due produttori in ProductCode e le due valute in Price).
 */
export function pulisciValore(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref[^>]*\/>/gi, ' ')
    .replace(/\{\{Ruby\|([^|}]*)\|[^}]*\}\}/gi, '$1')
    .replace(/'''?/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Solo cio' che sta dentro i commenti HTML, gia' ripulito. Stringa vuota se non ce ne sono. */
export function parteCommentata(raw: string): string {
  const dentro = [...raw.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
  return dentro.length ? pulisciValore(dentro.join(' <br> ')) : '';
}

/** Un pezzo di valore separato da <br>, con l'annotazione finale fra parentesi staccata. */
export interface PezzoBr {
  /** Il testo senza l'annotazione, es. "Arrow Wizard 4-80B". */
  testo: string;
  /** L'annotazione fra parentesi, es. "Hasbro", "Red Version", "anime, English". */
  nota: string | null;
}

/**
 * Valore spezzato sui <br>, con l'annotazione separata dal testo.
 *
 * "AKA=WizardArrow Four Eighty Ball<br>Arrow Wizard 4-80B ([[Hasbro]])<br>Arrow Wizard (anime, English)"
 * da' tre pezzi, di cui solo il secondo e' il nome commerciale Hasbro: senza separare la nota,
 * il nome uscirebbe con "(Hasbro)" appiccicato e nessun confronto funzionerebbe piu'.
 */
export function pezziBr(raw: string): PezzoBr[] {
  const pulito = pulisciValore(raw);
  if (!pulito) return [];
  return pulito
    .split(/<br\s*\/?>/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(p);
      return m ? { testo: m[1].trim(), nota: m[2].trim() || null } : { testo: p, nota: null };
    })
    .filter((p) => p.testo);
}

/**
 * Corpo di una sezione di secondo livello (==Nome==), sottosezioni comprese, fino alla
 * prossima intestazione di secondo livello o a fine pagina. Il primo nome che esiste vince.
 *
 * Il corpo torna SENZA i commenti HTML, ed e' il contrario di quel che fa l'infobox apposta.
 * Nel corpo della pagina un commento e' roba che il redattore ha deliberatamente nascosto
 * perche' non e' ancora un fatto, e spesso inghiotte righe intere: su LusterDragoon 6-60LC il
 * commento si apre dopo la release Takara Tomy e si chiude dopo l'intestazione ===Hasbro===,
 * cioe' nasconde un'intera sottosezione. Tagliando riga per riga resterebbe un "<!--" appeso
 * in coda a una release vera e comparirebbe una sezione Hasbro che la pagina non afferma.
 * Nell'infobox invece il commento dice "annunciato ma non ancora uscito", che e' un dato: la'
 * si legge con parteCommentata().
 */
export function sezione(wikitext: string, ...nomi: string[]): string | null {
  const testo = wikitext.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const nome of nomi) {
    const re = new RegExp(`^==\\s*${nome}\\s*==\\s*$([\\s\\S]*?)(?=^==[^=]|$(?![\\s\\S]))`, 'mi');
    const m = re.exec(testo);
    if (m) return m[1];
  }
  return null;
}

/** Sottosezioni di terzo livello (===Nome===) di un corpo di sezione, in ordine di pagina. */
export function sottosezioni(corpo: string): { titolo: string; corpo: string }[] {
  const out: { titolo: string; corpo: string }[] = [];
  const re = /^===\s*([^=\n]+?)\s*===\s*$/gm;
  const teste = [...corpo.matchAll(re)];
  for (let i = 0; i < teste.length; i += 1) {
    const inizio = teste[i].index! + teste[i][0].length;
    const fine = i + 1 < teste.length ? teste[i + 1].index! : corpo.length;
    out.push({ titolo: teste[i][1].trim(), corpo: corpo.slice(inizio, fine) });
  }
  return out;
}

/** Una voce puntata di una sezione: il testo della riga e i link che contiene. */
export interface VoceElenco {
  /** La riga ripulita, senza il bullet. */
  testo: string;
  /** I titoli linkati, nell'ordine, esclusi File:/Image:/Category:/Template:/User:. */
  link: string[];
}

/** Righe puntate (* o **) di un corpo di sezione. Le righe senza bullet si ignorano. */
export function vociElenco(corpo: string): VoceElenco[] {
  const out: VoceElenco[] = [];
  for (const riga of corpo.split(/\r?\n/)) {
    const m = /^\*+\s*(.+)$/.exec(riga.trim());
    if (!m) continue;
    const link = [...m[1].matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)]
      .map((x) => x[1].trim())
      .filter((t) => t && !/^(File|Image|Category|Template|User):/i.test(t));
    const testo = pulisciValore(m[1]);
    if (testo) out.push({ testo, link });
  }
  return out;
}
