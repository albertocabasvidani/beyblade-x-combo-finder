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
 *   category ∈ blade|lockChip|mainBlade|assistBlade|overBlade|ratchet|bit
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
// Percorsi sovrascrivibili da riga di comando: servono a test-wiki-scan.ts per far girare il
// merge su una COPIA del master in tmp/. Senza flag il comportamento e' identico a prima.
const argOpt = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const TMP = argOpt('--tmp', join(ROOT, 'tmp'));
const masterPath = argOpt('--master', join(DATA, 'parts-master.json'));
const conflictsPath = argOpt('--conflicts', join(DATA, 'parts-master-conflicts.json'));

const CATS = ['blades', 'lockChips', 'mainBlades', 'assistBlades', 'overBlades', 'ratchets', 'bits'] as const;
const CAT_OF: Record<string, typeof CATS[number]> = {
  blade: 'blades', lockChip: 'lockChips', mainBlade: 'mainBlades',
  assistBlade: 'assistBlades', overBlade: 'overBlades', ratchet: 'ratchets', bit: 'bits',
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
  e = list.find((x) => x.id === id);
  if (e) return e;
  // Ultimo livello: gli ALIAS. verify-against-wiki considera una parte "presente" anche quando il
  // nome del wiki corrisponde solo a un alias; se il merge non facesse altrettanto, sanare una
  // parte segnalata mancante creerebbe un DOPPIONE invece di arricchire la voce che gia' c'era.
  // Con questo livello il doppione e' impossibile per costruzione, non affidato all'attenzione
  // di chi legge il report.
  return list.find((x) => (x.aliases ?? []).some((a) => norm(a.value) === nt));
}

function addAlias(e: Entry, value: string | undefined | null, lang: string, kind: string) {
  if (!value) return;
  const v = String(value).trim();
  if (!v) return;
  if (e.names.tt && norm(v) === norm(e.names.tt)) return; // non duplicare il tt
  if (e.aliases.some((a) => norm(a.value) === norm(v) && a.kind === kind)) return;
  e.aliases.push({ value: v, lang, kind });
}

/**
 * Normalizza i codici prodotto. Sul wiki `ProductCode` e' un campo libero, spesso una riga sola
 * tipo "G0290 (Hasbro)<br>BX-00 (Takara Tomy)": chi lo copia di peso infila quella stringa intera
 * dentro products[], e da li' non esce piu'. Qui si spezza sui separatori, si buttano le
 * annotazioni fra parentesi e si tiene solo cio' che ha la FORMA di un codice.
 */
function normCodes(codes: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(codes) ? codes : [codes]) {
    if (typeof raw !== 'string') continue;
    for (const pezzo of raw.split(/<br\s*\/?>|[,;/\n]/)) {
      const c = pezzo.replace(/\([^)]*\)/g, '').replace(/'''?/g, '').trim();
      if (/^(?:BX|UX|CX|BXG)-\d+\w*$/i.test(c) || /^[A-Z]\d{3,4}$/.test(c)) out.push(c.toUpperCase());
    }
  }
  return [...new Set(out)];
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
  const illeggibili: string[] = [];
  let files: string[] = [];
  try { files = readdirSync(TMP).filter((f: string) => /^parts-extract-batch-.*\.json$/.test(f)); } catch {}
  for (const f of files) {
    try {
      // Il BOM va tolto prima di JSON.parse: su Windows i batch scritti da un subagent lo hanno
      // quasi sempre, e JSON.parse fallisce. Prima l'errore finiva in un console.warn e il merge
      // proseguiva come se niente fosse — cioe' un intero lotto di parti spariva in silenzio.
      const arr = JSON.parse(readFileSync(join(TMP, f), 'utf8').replace(/^﻿/, ''));
      if (Array.isArray(arr)) recs.push(...arr);
      else if (Array.isArray(arr.records)) recs.push(...arr.records);
      else { illeggibili.push(`${f}: nessun array di record`); }
    } catch (e) { illeggibili.push(`${f}: ${(e as Error).message}`); }
  }
  // Un batch illeggibile non e' un dettaglio: sono parti che non entreranno. Meglio fermarsi che
  // committare un aggiornamento parziale credendolo completo.
  if (illeggibili.length) {
    console.error(`\nBATCH ILLEGGIBILI (${illeggibili.length}):`);
    for (const m of illeggibili) console.error(`  ${m}`);
    console.error('Merge interrotto: nessuna modifica al master.');
    process.exit(1);
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
let enriched = 0, created = 0;

for (const r of records) {
  if (!r || !r.tt) continue;
  r.hasbro = cleanTag(r.hasbro);
  if (r.type) r.type = String(r.type).toLowerCase();
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
  for (const c of normCodes(r.productCodes)) if (!e.products.includes(c)) e.products.push(c);
  if (!e.firstReleaseSet) e.firstReleaseSet = normCodes(r.firstSet)[0] ?? pickFirstSet(e.products);
}

master.version = today();
for (const c of CATS) master[c] = byCat[c].slice().sort((a: Entry, b: Entry) => a.id.localeCompare(b.id));

writeFileSync(masterPath, JSON.stringify(master, null, 2) + '\n');
writeFileSync(conflictsPath, JSON.stringify({ generated: today(), count: conflicts.length, conflicts }, null, 2) + '\n');

console.log(`Merge completato: ${records.length} record processati → ${enriched} arricchimenti, ${created} parti nuove.`);
console.log(`Totali master: ${master.blades.length} blade, ${master.lockChips.length} lock chip, ${master.mainBlades.length} main blade, ${master.assistBlades.length} assist blade, ${master.overBlades.length} over blade, ${master.ratchets.length} ratchet, ${master.bits.length} bit.`);
console.log(`Conflitti: ${conflicts.length} (vedi data/parts-master-conflicts.json).`);
