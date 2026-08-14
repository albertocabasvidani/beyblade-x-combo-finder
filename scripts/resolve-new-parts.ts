/**
 * resolve-new-parts.ts — Impedisce i DOPPIONI da rinomino, prima che il merge li crei.
 *
 * Il problema, visto sul campo il 14/08/2026: nei set in collaborazione Hasbro ribattezza blade
 * gia' esistenti. La pagina prodotto "Spinosaurus 3-85A" dichiara `BladeX = Spinosaurus`, ma
 * `Blade - Spinosaurus` sul wiki e' un **#REDIRECT** a `Blade - Roar Tyranno`. Chi legge solo la
 * pagina prodotto conclude che "Spinosaurus" e' una blade nuova, e merge-master ne crea una
 * seconda copia accanto a quella che c'era gia'. Stessa storia per Quetzalcoatlus (→ Talon Ptera),
 * T. Rex (→ TyrannoBeat), Mosasaurus (→ TriceraSpiky).
 *
 * Qui ogni record che NON combacia con una parte del master viene ripescato attraverso la sua
 * pagina-parte dedicata (`Blade - X`, `Bit - X`, ...) risolvendo i redirect lato server: se il
 * titolo canonico corrisponde a una parte nota, il `tt` del record viene riscritto con quel nome
 * e il merge arricchisce invece di duplicare. Cio' che resta senza corrispondenza viene elencato:
 * quello si' che e' candidato a essere una parte davvero nuova, e va guardato.
 *
 * Gira PRIMA di merge-master, sui file tmp/parts-extract-batch-*.json (che riscrive).
 * Uso:  npx tsx scripts/resolve-new-parts.ts [--tmp <dir>] [--master <path>] [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { batchQuery } from './lib/wiki';

const ROOT = join(import.meta.dirname, '..');
const argOpt = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const TMP = argOpt('--tmp', join(ROOT, 'tmp'));
const MASTER = argOpt('--master', join(ROOT, 'data', 'parts-master.json'));
const DRY = process.argv.includes('--dry');

const CAT_OF: Record<string, string> = {
  blade: 'blades', lockChip: 'lockChips', mainBlade: 'mainBlades',
  assistBlade: 'assistBlades', overBlade: 'overBlades', ratchet: 'ratchets', bit: 'bits',
};
// Prefisso della pagina-parte dedicata sul wiki, per categoria.
const PREFISSO: Record<string, string> = {
  blade: 'Blade - ', lockChip: 'Lock Chip - ', mainBlade: 'Main Blade - ',
  assistBlade: 'Assist Blade - ', overBlade: 'Over Blade - ', ratchet: 'Ratchet - ', bit: 'Bit - ',
};

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const kebab = (s: string) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stripPrefisso = (t: string) => { const i = t.indexOf(' - '); return i >= 0 ? t.slice(i + 3) : t; };

const master = JSON.parse(readFileSync(MASTER, 'utf8'));

/** Stesse regole di findExisting in merge-master.ts, alias compresi. */
function esisteNelMaster(category: string, tt: string): boolean {
  const list = master[CAT_OF[category]] ?? [];
  const nt = norm(tt);
  return list.some((x: any) =>
    norm(x.names?.tt) === nt ||
    norm(x.names?.hasbro || '') === nt ||
    x.id === kebab(tt) ||
    (x.aliases ?? []).some((a: any) => norm(a.value) === nt));
}

const files = readdirSync(TMP).filter((f: string) => /^parts-extract-batch-.*\.json$/.test(f));
const contenuti = new Map<string, any[]>();
const daRisolvere = new Map<string, { category: string; tt: string }>(); // titolo pagina -> record

for (const f of files) {
  let arr: any[];
  try { arr = JSON.parse(readFileSync(join(TMP, f), 'utf8').replace(/^﻿/, '')); } catch { continue; }
  if (!Array.isArray(arr)) continue;
  contenuti.set(f, arr);
  for (const r of arr) {
    if (!r?.tt || !r?.category || !PREFISSO[r.category]) continue;
    if (esisteNelMaster(r.category, r.tt)) continue;
    daRisolvere.set(PREFISSO[r.category] + r.tt, { category: r.category, tt: r.tt });
  }
}

if (!daRisolvere.size) {
  console.log(`Nessun record senza corrispondenza nel master (${files.length} batch esaminati). Niente da risolvere.`);
  process.exit(0);
}

console.log(`${daRisolvere.size} nomi non corrispondono a parti note: li ripesco dalle pagine-parte del wiki.`);
const risolti = await batchQuery([...daRisolvere.keys()]);

const rinomini = new Map<string, string>(); // "categoria|ttVecchio" -> ttNuovo
const irrisolti: string[] = [];

for (const [richiesto, info] of risolti) {
  const rec = daRisolvere.get(richiesto)!;
  if (info.missing) { irrisolti.push(`${rec.category} "${rec.tt}" (nessuna pagina ${richiesto})`); continue; }
  const nome = stripPrefisso(info.canonical);
  if (norm(nome) === norm(rec.tt)) { irrisolti.push(`${rec.category} "${rec.tt}" (pagina esiste, non e' un rinomino)`); continue; }
  if (!esisteNelMaster(rec.category, nome)) { irrisolti.push(`${rec.category} "${rec.tt}" -> "${nome}", che pero' non e' nel master`); continue; }
  rinomini.set(`${rec.category}|${rec.tt}`, nome);
  console.log(`  "${rec.tt}" e' un rinomino di "${nome}" (${richiesto} -> ${info.canonical})`);
}

let toccati = 0;
for (const [f, arr] of contenuti) {
  let cambiato = false;
  for (const r of arr) {
    const nuovo = rinomini.get(`${r.category}|${r.tt}`);
    if (!nuovo) continue;
    r.aliasDa = r.tt;   // traccia da dove veniva, per chi legge il batch dopo
    r.tt = nuovo;
    cambiato = true; toccati++;
  }
  if (cambiato && !DRY) writeFileSync(join(TMP, f), JSON.stringify(arr, null, 1) + '\n');
}

console.log(`\n${rinomini.size} nomi risolti, ${toccati} record riscritti${DRY ? ' (prova, nessuna scrittura)' : ''}.`);
if (irrisolti.length) {
  console.log(`\n${irrisolti.length} restano senza corrispondenza — sono i veri candidati a "parte nuova", da guardare:`);
  for (const i of irrisolti) console.log(`  ${i}`);
}
