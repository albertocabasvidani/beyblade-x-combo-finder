/**
 * build-parts.ts — Derivazione deterministica del database parti.
 *
 * Input:  data/parts-master.json  (file canonico multilingua, popolato da /scrape-parts-master)
 * Output: data/parts.json         (schema consumato dal sito, vedi src/lib/types.ts)
 *
 * Guardrail: prima di scrivere parts.json, verifica che OGNI id parte referenziato
 * da data/combos.json e data/products.json esista nel nuovo parts.json. Se trova
 * riferimenti penzolanti, ABORTA senza scrivere (protegge i dati a valle).
 *
 * Questo è codice puramente deterministico (trasformazione di formato): nessuna
 * interpretazione di pagine o match di nomi (quelli li fa l'IA in /scrape-parts-master).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const masterPath = join(DATA, 'parts-master.json');
const partsPath = join(DATA, 'parts.json');
const combosPath = join(DATA, 'combos.json');
const productsPath = join(DATA, 'products.json');

type Names = { tt: string; ttRaw?: string; hasbro?: string | null; ja?: string; romaji?: string };
type Alias = { value: string; lang?: string; kind?: string };
type Stats = { atk: number; def: number; sta: number };
interface MasterPart {
  id: string;
  category?: string;
  line?: string;
  type?: string;
  names: Names;
  aliases?: Alias[];
  shortName?: string;
  short?: string;
  firstReleaseSet?: string;
  integratedRatchet?: boolean;
  stats?: Stats;
  source?: { page?: string; url?: string; revid?: number };
}
interface Master {
  version?: string;
  blades?: MasterPart[];
  lockChips?: MasterPart[];
  mainBlades?: MasterPart[];
  assistBlades?: MasterPart[];
  overBlades?: MasterPart[];
  ratchets?: MasterPart[];
  bits?: MasterPart[];
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const withWestern = (n: Names) => (n.hasbro ? { nameWestern: n.hasbro } : {});

// Alias in forma latina (no scritture native ja/ko/zh): utili al match dei nomi nelle fonti EN
// come WBO. Il resolver scarta quelli che contengono un ratchet (es. "Impact Drake 9-60LR").
const latinAliases = (p: MasterPart): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of p.aliases ?? []) {
    if (a.kind === 'native' || !a.value) continue;
    if (a.value === p.names.tt || a.value === p.names.hasbro) continue;
    if (seen.has(a.value)) continue;
    seen.add(a.value);
    out.push(a.value);
  }
  return out;
};
const withAliases = (p: MasterPart) => {
  const a = latinAliases(p);
  return a.length ? { aliases: a } : {};
};
const withShort = (p: MasterPart) => {
  const s = p.shortName ?? p.short;
  return s ? { shortName: s } : {};
};
// Stat 3 assi dall'infobox Fandom (pagina dedicata della parte). Pass-through verbatim: se il
// master non le ha (caso attuale per quasi tutte) il campo resta assente e parts.json non cambia.
const withStats = (p: MasterPart) => (p.stats ? { stats: p.stats } : {});

// Bey a ratchet integrato (no ratchet separato, es. Cutter Shinobi, Bullet Griffon): segnalato dalla
// pagina wiki "Ratchet-Integrated Blade - ..." o da un flag esplicito nel master (per i casi la cui
// pagina non ha il prefisso, es. Bullet Griffon). Esposto in parts.json così il parser combo sa che una
// riga senza ratchet può essere un combo valido [blade integrato] + [bit].
const isIntegratedRatchet = (p: MasterPart): boolean =>
  p.integratedRatchet === true || /^Ratchet-Integrated Blade\b/i.test(p.source?.page ?? '');

function deriveParts(master: Master) {
  const blades = (master.blades ?? []).slice().sort(byId).map((p) => ({
    id: p.id,
    name: p.names.tt,
    ...withWestern(p.names),
    ...withAliases(p),
    type: p.type,
    line: p.line ?? 'bx',
    ...(isIntegratedRatchet(p) ? { integratedRatchet: true } : {}),
    ...(p.firstReleaseSet ? { releaseSet: p.firstReleaseSet } : {}),
    ...withStats(p),
  }));

  const lockChips = (master.lockChips ?? []).slice().sort(byId).map((p) => ({
    id: p.id,
    name: p.names.tt,
    ...withWestern(p.names),
    line: 'cx',
  }));

  const mainBlades = (master.mainBlades ?? []).slice().sort(byId).map((p) => ({
    id: p.id,
    name: p.names.tt,
    ...withWestern(p.names),
    ...(p.type ? { type: p.type } : {}),  // usato come type del combo CX (fallback 'balance' nel resolver)
    line: 'cx',
    ...withStats(p),
  }));

  const assistBlades = (master.assistBlades ?? []).slice().sort(byId).map((p) => {
    const short = p.shortName ?? p.short ?? '';
    return {
      id: p.id,
      name: short ? `${short} (${p.names.tt})` : p.names.tt,
      ...withWestern(p.names),
      shortName: short,
      line: 'cx',
    };
  });

  const overBlades = (master.overBlades ?? []).slice().sort(byId).map((p) => ({
    id: p.id,
    name: p.names.tt,
    ...withWestern(p.names),
    line: 'cx',
  }));

  const ratchets = (master.ratchets ?? []).slice().sort(byId).map((p) => {
    const [s, h] = p.id.split('-');
    return { id: p.id, name: p.names.tt ?? p.id, sides: Number(s), height: Number(h), ...withStats(p) };
  });

  const bits = (master.bits ?? []).slice().sort(byId).map((p) => ({
    id: p.id,
    name: p.names.tt,
    type: p.type,
    ...withShort(p),
    ...withAliases(p),
    ...withStats(p),
  }));

  return { version: today(), blades, lockChips, mainBlades, assistBlades, overBlades, ratchets, bits };
}

type IdSets = Record<string, Set<string>>;

function collectIds(parts: ReturnType<typeof deriveParts>): IdSets {
  return {
    blade: new Set(parts.blades.map((p) => p.id)),
    lockChip: new Set(parts.lockChips.map((p) => p.id)),
    mainBlade: new Set(parts.mainBlades.map((p) => p.id)),
    assistBlade: new Set(parts.assistBlades.map((p) => p.id)),
    overBlade: new Set(parts.overBlades.map((p) => p.id)),
    ratchet: new Set(parts.ratchets.map((p) => p.id)),
    bit: new Set(parts.bits.map((p) => p.id)),
  };
}

function flattenProducts(products: any): any[] {
  const out: any[] = [];
  const root = products.products ?? products;
  for (const brand of Object.keys(root)) {
    const group = root[brand];
    if (!group || typeof group !== 'object') continue;
    for (const k of Object.keys(group)) {
      if (Array.isArray(group[k])) out.push(...group[k]);
    }
  }
  return out;
}

const FIELDS: [string, string][] = [
  ['blade', 'blade'], ['ratchet', 'ratchet'], ['bit', 'bit'],
  ['lockChip', 'lockChip'], ['mainBlade', 'mainBlade'], ['assistBlade', 'assistBlade'],
  ['overBlade', 'overBlade'],
];

/**
 * Riferimenti penzolanti separati per fonte:
 *  - combos: dati mostrati all'utente → ogni parte DEVE esistere (abort se mancano).
 *  - products: catalogo (link Amazon), storicamente più ampio del registro parti →
 *    warning non bloccante; le mancanti sono lavoro per l'import parti.
 */
function checkRefs(parts: ReturnType<typeof deriveParts>, combos: any, products: any) {
  const ids = collectIds(parts);
  const combosDangling: string[] = [];
  const productsDangling = new Set<string>();

  for (const c of combos.combos ?? []) {
    for (const [cat, key] of FIELDS) {
      const id = c[key];
      if (id && !ids[cat].has(id)) combosDangling.push(`combos.json / ${c.id}: ${cat} '${id}'`);
    }
  }
  for (const p of flattenProducts(products)) {
    for (const [cat, key] of FIELDS) {
      const id = p[key];
      if (id && !ids[cat].has(id)) productsDangling.add(`${cat}:${id}`);
    }
  }
  return { combosDangling, productsDangling: [...productsDangling].sort() };
}

function main() {
  const master: Master = JSON.parse(readFileSync(masterPath, 'utf8'));
  const combos = JSON.parse(readFileSync(combosPath, 'utf8'));
  const products = JSON.parse(readFileSync(productsPath, 'utf8'));

  const newParts = deriveParts(master);
  const { combosDangling, productsDangling } = checkRefs(newParts, combos, products);

  if (combosDangling.length > 0) {
    console.error(`\nGUARDRAIL FALLITO: ${combosDangling.length} riferimenti penzolanti in combos.json. parts.json NON è stato scritto.\n`);
    for (const d of combosDangling) console.error('  - ' + d);
    console.error('\nIl master non copre tutte le parti usate dalle combo. Correggi parts-master.json e riprova.');
    process.exit(1);
  }

  writeFileSync(partsPath, JSON.stringify(newParts, null, 2) + '\n');
  console.log(
    `parts.json rigenerato (${newParts.version}): ` +
    `${newParts.blades.length} blade, ${newParts.lockChips.length} lock chip, ` +
    `${newParts.mainBlades.length} main blade, ${newParts.assistBlades.length} assist blade, ` +
    `${newParts.overBlades.length} over blade, ${newParts.ratchets.length} ratchet, ${newParts.bits.length} bit. Guardrail combos OK.`
  );

  if (productsDangling.length > 0) {
    console.warn(`\n⚠️  ${productsDangling.length} parti referenziate da products.json NON sono ancora nel master (da completare con /scrape-parts-master):`);
    console.warn('  ' + productsDangling.join(', '));
  }
}

main();
