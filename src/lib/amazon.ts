export interface AmazonConfig {
  tld: string;
  tag: string;
}

export interface ProductLookup {
  ratchets: Record<string, string>;
  bits: Record<string, string>;
}

function flattenProducts(productsData: any): any[] {
  const flat: any[] = [];
  const categories = productsData.products;
  for (const manufacturer of Object.values(categories)) {
    for (const subcategory of Object.values(manufacturer as Record<string, any>)) {
      if (Array.isArray(subcategory)) {
        flat.push(...subcategory);
      }
    }
  }
  return flat;
}

/**
 * Build a compact lookup mapping ratchet/bit IDs to a product code.
 * Prefers regular releases over limited editions (BX-00, UX-00, CX-00).
 */
export function buildProductLookup(productsData: any): ProductLookup {
  const products = flattenProducts(productsData);
  const ratchets: Record<string, string> = {};
  const bits: Record<string, string> = {};

  const sorted = [...products].sort((a, b) => {
    const aLimited = a.code.endsWith('-00') || a.code === 'G0000';
    const bLimited = b.code.endsWith('-00') || b.code === 'G0000';
    if (aLimited !== bLimited) return aLimited ? 1 : -1;
    return a.code.localeCompare(b.code);
  });

  for (const p of sorted) {
    if (p.ratchet && !ratchets[p.ratchet]) ratchets[p.ratchet] = p.code;
    if (p.bit && !bits[p.bit]) bits[p.bit] = p.code;
  }

  return { ratchets, bits };
}

function partNameForSearch(partType: string, partId: string): string {
  if (partType === 'ratchet') return partId;
  return partId.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function buildAmazonSearchUrl(
  partType: string,
  partId: string,
  productLookup: ProductLookup,
  config: AmazonConfig,
): string {
  let query: string;

  if (partType === 'blade' || partType === 'lockChip' || partType === 'mainBlade' || partType === 'assistBlade') {
    query = `Beyblade X ${partNameForSearch(partType, partId)}`;
  } else if (partType === 'ratchet') {
    const code = productLookup.ratchets[partId];
    query = code ? `Beyblade X ${code}` : `Beyblade X ${partId}`;
  } else if (partType === 'bit') {
    const code = productLookup.bits[partId];
    query = code ? `Beyblade X ${code}` : `Beyblade X ${partNameForSearch(partType, partId)}`;
  } else {
    query = `Beyblade X ${partNameForSearch(partType, partId)}`;
  }

  const encoded = encodeURIComponent(query);
  const base = `https://www.amazon.${config.tld}/s?k=${encoded}`;
  return config.tag ? `${base}&tag=${config.tag}` : base;
}
