/**
 * bootstrap-master.ts — One-shot: genera data/parts-master.json a partire dall'attuale
 * data/parts.json. Serve come BASE del master (preserva tutti gli id esistenti); l'import
 * /scrape-parts-master poi lo arricchisce con i nomi mancanti (ja, romaji, hasbro) e le parti
 * nuove lette da Beyblade Fandom Wiki.
 *
 * I campi names.ja / names.romaji / aliases restano vuoti qui: li popola l'IA dall'import.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const parts = JSON.parse(readFileSync(join(DATA, 'parts.json'), 'utf8'));

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const names = (tt: string, hasbro?: string) => ({
  tt,
  hasbro: hasbro ?? null,
  ja: '',
  romaji: '',
});

// "A (Assault)" -> "Assault" ; fallback al nome intero
const innerName = (name: string) => {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1] : name;
};

const master = {
  version: today(),
  generator: 'scripts/bootstrap-master.ts (base) — arricchito da /scrape-parts-master',
  blades: parts.blades.map((p: any) => ({
    id: p.id, category: 'blade', line: p.line ?? 'bx', type: p.type,
    names: names(p.name, p.nameWestern), aliases: [],
    firstReleaseSet: p.releaseSet ?? null, products: [],
    source: null, status: 'unverified',
  })),
  lockChips: parts.lockChips.map((p: any) => ({
    id: p.id, category: 'lockChip', line: 'cx',
    names: names(p.name, p.nameWestern), aliases: [],
    source: null, status: 'unverified',
  })),
  mainBlades: parts.mainBlades.map((p: any) => ({
    id: p.id, category: 'mainBlade', line: 'cx',
    names: names(p.name, p.nameWestern), aliases: [],
    source: null, status: 'unverified',
  })),
  assistBlades: parts.assistBlades.map((p: any) => ({
    id: p.id, category: 'assistBlade', line: 'cx', shortName: p.shortName,
    names: names(innerName(p.name), p.nameWestern), aliases: [],
    source: null, status: 'unverified',
  })),
  ratchets: parts.ratchets.map((p: any) => ({
    id: p.id, category: 'ratchet',
    names: { tt: p.name, ja: '', romaji: '' }, aliases: [],
    source: null, status: 'unverified',
  })),
  bits: parts.bits.map((p: any) => ({
    id: p.id, category: 'bit', type: p.type,
    names: names(p.name), aliases: [],
    source: null, status: 'unverified',
  })),
};

writeFileSync(join(DATA, 'parts-master.json'), JSON.stringify(master, null, 2) + '\n');
console.log(
  `parts-master.json creato (base): ${master.blades.length} blade, ${master.lockChips.length} lock chip, ` +
  `${master.mainBlades.length} main blade, ${master.assistBlades.length} assist blade, ` +
  `${master.ratchets.length} ratchet, ${master.bits.length} bit.`
);
