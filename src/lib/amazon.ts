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
 * Il tag (tracking ID Associates dedicato al sito) sta in `data/amazon-config.json`, per marketplace;
 * tag vuoto = nessun `&tag=` (è il caso di amazon.com: nessun account US).
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

function withTag(url: string, tag: string): string {
  if (!tag) return url;
  return url + (url.includes('?') ? '&' : '?') + 'tag=' + encodeURIComponent(tag);
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
): { href: string; kind: AmazonLinkKind } {
  const mk = config.marketplaces[market] ?? config.marketplaces[config.defaultMarketplace];
  const code = lookup[category]?.[partId];
  const asin = code ? asins[code]?.[market] : undefined;
  if (asin) return { href: withTag(`https://www.${mk.tld}/dp/${asin}`, mk.tag), kind: 'dp' };

  let query: string;
  if (NAME_SEARCH.has(category)) query = `Beyblade X ${partName || partId}`;
  else if (code) query = `Beyblade X ${code}`;
  else query = `Beyblade X ${partName || partId}`;
  return { href: withTag(`https://www.${mk.tld}/s?k=${encodeURIComponent(query)}`, mk.tag), kind: 'search' };
}
