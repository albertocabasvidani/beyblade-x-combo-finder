/**
 * amazon.ts — link affiliati Amazon per le parti mancanti.
 *
 * Due forme di link, in ordine di preferenza:
 *  1. prodotto diretto `/dp/{ASIN}` quando `data/amazon-asins.json` (scritto da
 *     `npm run sync:amazon-asins`, dallo stato del monitor bbxdealmonitor) conosce l'ASIN del set che
 *     contiene la parte su quel marketplace;
 *  2. ricerca `/s?k=…`. Gotcha storico: blade/lock chip/main/assist/over blade si cercano per NOME
 *     («Beyblade X Phoenix Wing»); ratchet e bit per nome danno 0 risultati, quindi si cerca il CODICE
 *     del set che li contiene («Beyblade X BX-01»).
 *
 * Il tag (tracking ID Associates dedicato al sito) sta in `data/amazon-config.json`, per marketplace.
 * Ogni marketplace elencato lì deve averne uno: un tag vuoto fa sollevare `withTag`, quindi rompe la
 * build invece di produrre link che non pagano e che Amazon contesta.
 */

export interface AmazonMarketplace { tld: string; tag: string }
export interface AmazonConfigFile {
  defaultMarketplace: string;
  marketplaces: Record<string, AmazonMarketplace>;
}
/** codice prodotto (BX-01) → mercato (it/de/…) → ASIN */
export type AsinIndex = Record<string, Record<string, string>>;
/** categoria singolare (blade/ratchet/…) → id parte → codice prodotto */
export type PartLookup = Record<string, Record<string, string>>;
export type AmazonLinkKind = 'dp' | 'search';

export const PART_KEYS = ['blade', 'lockChip', 'mainBlade', 'assistBlade', 'overBlade', 'ratchet', 'bit'] as const;
const NAME_SEARCH = new Set(['blade', 'lockChip', 'mainBlade', 'assistBlade', 'overBlade']);

/**
 * Amazon sposta da sé un visitatore verso il negozio del suo paese (OneLink), e questo parametro
 * glielo impedisce: si aggiunge solo ai link costruiti dopo che il visitatore ha scelto il negozio
 * a mano, perché lì la sua scelta deve valere anche dopo il click. Sui link scelti dal sito non si
 * mette, così Amazon resta libero di correggere un rilevamento sbagliato.
 *
 * Il nome del parametro è quello che Amazon stessa scrive nell'URL di arrivo dei suoi redirect;
 * verificato dalla Germania il 21/09/2026: con il parametro il link amazon.com resta su amazon.com,
 * senza finisce su amazon.de.
 */
export const KEEP_STORE_PARAM = 'creatorsDisableRedirect=true';

function flattenProducts(productsData: any): any[] {
  const flat: any[] = [];
  for (const manufacturer of Object.values(productsData.products ?? {})) {
    for (const subcategory of Object.values(manufacturer as Record<string, any>)) {
      if (Array.isArray(subcategory)) flat.push(...subcategory);
    }
  }
  return flat;
}

/**
 * Ordine di preferenza dei codici: Takara Tomy regolare (BX/UX/CX-NN) → Hasbro (G1539, F9580…) →
 * edizione limitata (-00, G0000). Prima vinceva `localeCompare` puro, e per una parte presente in un
 * set Hasbro e in uno UX vinceva il codice Hasbro (es. `accel → G1536`): sui marketplace europei
 * quei codici non esistono e la ricerca dava zero risultati.
 */
function codeRank(code: string): number {
  if (code.endsWith('-00') || code === 'G0000') return 2;
  if (/^(BX|UX|CX)-\d+$/.test(code)) return 0;
  return 1;
}

/** idParte → codice set, per tutte le categorie (CX comprese, dai set `customLine` e `cxStarterPacks`). */
export function buildPartLookup(productsData: any): PartLookup {
  const sorted = [...flattenProducts(productsData)].sort(
    (a, b) => codeRank(a.code) - codeRank(b.code) || a.code.localeCompare(b.code),
  );
  const lookup: PartLookup = Object.fromEntries(PART_KEYS.map((k) => [k, {}]));
  for (const p of sorted) {
    for (const k of PART_KEYS) {
      const id = p[k];
      if (typeof id === 'string' && id && !lookup[k][id]) lookup[k][id] = p.code;
    }
  }
  return lookup;
}

/** @deprecated compatibilità col vecchio design: usa buildPartLookup. */
export function buildProductLookup(productsData: any): { ratchets: Record<string, string>; bits: Record<string, string> } {
  const l = buildPartLookup(productsData);
  return { ratchets: l.ratchet, bits: l.bit };
}

/**
 * Un URL Amazon senza `tag=` non paga e viola le policy Associates: qui è un errore, non un caso
 * ammesso. Prima il tag vuoto era accettato in silenzio (era il caso di amazon.com, senza account
 * US) e il difetto è arrivato fino alla revisione Amazon del 19/09/2026. La difesa sta qui e non
 * nella config perché la config la riscrive chiunque, mentre questo solleva in build.
 */
function withTag(url: string, tag: string, keepStore = false): string {
  if (!tag) throw new Error(`Link Amazon senza tracking ID: ${url}. Ogni marketplace in data/amazon-config.json deve avere un tag.`);
  const sep = url.includes('?') ? '&' : '?';
  const tagged = `${url}${sep}tag=${encodeURIComponent(tag)}`;
  return keepStore ? `${tagged}&${KEEP_STORE_PARAM}` : tagged;
}

/**
 * Link Amazon per una parte. `partName` è il nome risolto dal registro (non lo slug): è quello che si
 * cerca per blade/lock chip/main/assist/over blade.
 */
export function buildAmazonUrl(
  category: string,
  partId: string,
  partName: string,
  lookup: PartLookup,
  asins: AsinIndex,
  market: string,
  config: AmazonConfigFile,
  keepStore = false,
): { href: string; kind: AmazonLinkKind } {
  const mk = config.marketplaces[market] ?? config.marketplaces[config.defaultMarketplace];
  const code = lookup[category]?.[partId];
  const asin = code ? asins[code]?.[market] : undefined;
  if (asin) return { href: withTag(`https://www.${mk.tld}/dp/${asin}`, mk.tag, keepStore), kind: 'dp' };

  let query: string;
  if (NAME_SEARCH.has(category)) query = `Beyblade X ${partName || partId}`;
  else if (code) query = `Beyblade X ${code}`;
  else query = `Beyblade X ${partName || partId}`;
  return { href: withTag(`https://www.${mk.tld}/s?k=${encodeURIComponent(query)}`, mk.tag, keepStore), kind: 'search' };
}
