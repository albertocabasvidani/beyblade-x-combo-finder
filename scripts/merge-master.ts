/**
 * merge-master.ts — Consolida i record per-parte estratti dai subagent (tmp/parts-extract-batch-*.json
 * + tmp/parts-extract-cx-pilot.json) dentro data/parts-master.json (base da bootstrap).
 *
 * Confine IA/codice: i subagent (IA) hanno già fatto la parte non-deterministica (leggere le pagine,
 * identificare tt/hasbro/ja/romaji per parte). Questo script fa solo il consolidamento DETERMINISTICO:
 * dedup per id (kebab-case del nome TT, con match sugli id esistenti), arricchimento dei campi vuoti,
 * accumulo di alias/prodotti. Le ambiguità finiscono in data/parts-master-conflicts.json.
 *
 * Record flat atteso (un oggetto per parte):
 *   { category, tt, hasbro?, ja?, romaji?, short?, type?, line?, fromProduct?, fromUrl?,
 *     productCodes?: string[], firstSet?: string }
 *   category ∈ blade|lockChip|mainBlade|assistBlade|ratchet|bit  (overBlade → alias variant, vedi sotto)
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const TMP = join(ROOT, 'tmp');
const masterPath = join(DATA, 'parts-master.json');

const CATS = ['blades', 'lockChips', 'mainBlades', 'assistBlades', 'ratchets', 'bits'] as const;
const CAT_OF: Record<string, typeof CATS[number]> = {
  blade: 'blades', lockChip: 'lockChips', mainBlade: 'mainBlades',
  assistBlade: 'assistBlades', ratchet: 'ratchets', bit: 'bits',
};

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const kebab = (s: string) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Rimuove i tag di provenienza dai nomi (es. "Coil Orochi (Hasbro)" → "Coil Orochi")
const cleanTag = (s: string | null | undefined): string | null => {
  if (!s) return s ?? null;
  const v = s.replace(/\s*\((?:Hasbro|anime[^)]*)\)\s*/gi, '').trim();
  return v || null;
};
const lc = (s: string | null | undefined): string | undefined => (s ? s.toLowerCase() : undefined);

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Alias = { value: string; lang: string; kind: string };
interface Entry {
  id: string; category: string; line?: string; type?: string; shortName?: string;
  names: { tt: string; ttRaw?: string; hasbro?: string | null; ja?: string; romaji?: string };
  aliases: Alias[]; stats?: any;
  products?: string[]; firstReleaseSet?: string | null;
  source?: any; lastVerified?: string; status?: string;
}

const master = JSON.parse(readFileSync(masterPath, 'utf8'));
const conflicts: any[] = [];

// Indici per match: per categoria, mappa norm(tt) e norm(hasbro) -> entry
const byCat: Record<string, Entry[]> = {};
for (const c of CATS) byCat[c] = master[c] ?? [];

// Normalizzazione del master già caricato (idempotente): pulisce tag di provenienza e
// minuscola i type, così il ri-merge corregge anche i valori scritti da run precedenti.
for (const c of CATS) {
  for (const e of byCat[c]) {
    if (e.names) e.names.hasbro = cleanTag(e.names.hasbro);
    if (e.type) e.type = e.type.toLowerCase();
    if (Array.isArray(e.aliases)) {
      const seen = new Set<string>();
      e.aliases = e.aliases
        .map((a) => ({ ...a, value: cleanTag(a.value) as string }))
        .filter((a) => a.value && !seen.has(a.kind + '|' + norm(a.value)) && (seen.add(a.kind + '|' + norm(a.value)), true));
    }
  }
}

function findExisting(cat: string, tt: string, hasbro?: string | null): Entry | undefined {
  const list = byCat[cat];
  const nt = norm(tt);
  let e = list.find((x) => norm(x.names.tt) === nt);
  if (e) return e;
  if (hasbro) {
    const nh = norm(hasbro);
    e = list.find((x) => norm(x.names.hasbro || '') === nh);
    if (e) return e;
  }
  // record tt potrebbe essere il nome Hasbro di una parte TT esistente
  e = list.find((x) => norm(x.names.hasbro || '') === nt);
  if (e) return e;
  const id = kebab(tt);
  return list.find((x) => x.id === id);
}

function addAlias(e: Entry, value: string | undefined | null, lang: string, kind: string) {
  if (!value) return;
  const v = String(value).trim();
  if (!v) return;
  if (e.names.tt && norm(v) === norm(e.names.tt)) return; // non duplicare il tt
  if (e.aliases.some((a) => norm(a.value) === norm(v) && a.kind === kind)) return;
  e.aliases.push({ value: v, lang, kind });
}

function pickFirstSet(codes: string[]): string | null {
  if (!codes?.length) return null;
  const regular = codes.filter((c) => /^(BX|UX|CX)-\d+$/.test(c) && !c.endsWith('-00'));
  const pool = regular.length ? regular : codes;
  return pool.slice().sort()[0];
}

// Carica tutti i batch + il pilota CX (formato annidato → appiattito)
function loadRecords(): any[] {
  const recs: any[] = [];
  let files: string[] = [];
  try { files = readdirSync(TMP).filter((f) => /^parts-extract-batch-.*\.json$/.test(f)); } catch {}
  for (const f of files) {
    try {
      const arr = JSON.parse(readFileSync(join(TMP, f), 'utf8'));
      if (Array.isArray(arr)) recs.push(...arr);
      else if (Array.isArray(arr.records)) recs.push(...arr.records);
    } catch (e) { console.warn(`Batch illeggibile ${f}: ${(e as Error).message}`); }
  }
  // Pilota CX (formato {products:[{parts:{cat:{...}}}]}) → record flat
  try {
    const pilot = JSON.parse(readFileSync(join(TMP, 'parts-extract-cx-pilot.json'), 'utf8'));
    for (const p of pilot.products ?? []) {
      for (const [k, v] of Object.entries<any>(p.parts ?? {})) {
        if (!v || !v.tt) continue;
        const category = k === 'overBlade' ? 'overBlade' : k;
        recs.push({
          category, tt: v.tt, hasbro: v.hasbro ?? null, ja: v.ja ?? null, romaji: v.romaji ?? null,
          short: v.short ?? null, line: p.line, fromProduct: p.pageTitle,
          productCodes: Object.values(p.productCodes ?? {}).filter(Boolean), firstSet: p.productCodes?.tt ?? null,
        });
      }
    }
  } catch {}
  return recs;
}

const records = loadRecords();
let enriched = 0, created = 0, overblades = 0;

for (const r of records) {
  if (!r || !r.tt) continue;
  r.hasbro = cleanTag(r.hasbro);
  if (r.type) r.type = String(r.type).toLowerCase();
  // overBlade: non è una categoria del modello → registra come alias variant sul mainBlade omonimo se esiste,
  // altrimenti ignora (annotato nei conflitti per decisione futura).
  if (r.category === 'overBlade') {
    overblades++;
    conflicts.push({ type: 'over_blade', value: r.tt, from: r.fromProduct, detail: 'Expand Blade OverBlade: non modellato come categoria separata' });
    continue;
  }
  const cat = CAT_OF[r.category];
  if (!cat) { conflicts.push({ type: 'unknown_category', record: r }); continue; }

  let e = findExisting(cat, r.tt, r.hasbro);
  if (!e) {
    e = {
      id: r.category === 'ratchet' ? r.tt : kebab(r.tt), category: r.category, line: r.line,
      names: { tt: r.tt }, aliases: [],
      products: [], firstReleaseSet: null, source: r.fromUrl ? { page: r.fromProduct, url: r.fromUrl } : null,
      lastVerified: today(), status: 'verified',
    };
    if (r.category === 'assistBlade' && r.short) e.shortName = r.short;
    if (r.type) e.type = r.type;
    byCat[cat].push(e);
    created++;
  } else {
    enriched++;
    e.status = 'verified';
    e.lastVerified = today();
    if (r.fromUrl && !e.source) e.source = { page: r.fromProduct, url: r.fromUrl };
  }

  // Arricchimento campi vuoti (non sovrascrivere valori diversi: segnala conflitto)
  const n = e.names;
  if (!n.ja && r.ja) n.ja = r.ja;
  if (!n.romaji && r.romaji) n.romaji = r.romaji;
  if (r.hasbro) {
    if (!n.hasbro) n.hasbro = r.hasbro;
    else if (norm(n.hasbro) !== norm(r.hasbro))
      conflicts.push({ type: 'hasbro_mismatch', id: e.id, existing: n.hasbro, found: r.hasbro, from: r.fromProduct });
  }
  if (r.type) {
    if (!e.type) e.type = r.type;
    else if (e.type !== r.type && (cat === 'blades' || cat === 'bits'))
      conflicts.push({ type: 'type_mismatch', id: e.id, existing: e.type, found: r.type, from: r.fromProduct });
  }
  if (r.category === 'assistBlade' && r.short && !e.shortName) e.shortName = r.short;

  addAlias(e, n.hasbro, 'en', 'hasbro');
  addAlias(e, r.ja, 'ja', 'native');
  addAlias(e, r.romaji, 'ja', 'romaji');

  // Prodotti / firstReleaseSet
  e.products = e.products ?? [];
  for (const c of r.productCodes ?? []) if (c && !e.products.includes(c)) e.products.push(c);
  if (!e.firstReleaseSet) e.firstReleaseSet = r.firstSet ?? pickFirstSet(e.products);
}

master.version = today();
for (const c of CATS) master[c] = byCat[c].slice().sort((a: Entry, b: Entry) => a.id.localeCompare(b.id));

writeFileSync(masterPath, JSON.stringify(master, null, 2) + '\n');
writeFileSync(join(DATA, 'parts-master-conflicts.json'), JSON.stringify({ generated: today(), count: conflicts.length, conflicts }, null, 2) + '\n');

console.log(`Merge completato: ${records.length} record processati → ${enriched} arricchimenti, ${created} parti nuove, ${overblades} overBlade annotati.`);
console.log(`Totali master: ${master.blades.length} blade, ${master.lockChips.length} lock chip, ${master.mainBlades.length} main blade, ${master.assistBlades.length} assist blade, ${master.ratchets.length} ratchet, ${master.bits.length} bit.`);
console.log(`Conflitti: ${conflicts.length} (vedi data/parts-master-conflicts.json).`);
