/**
 * verify-against-wiki.ts — Verifica di completezza del registro parti contro una FONTE AFFIDABILE.
 *
 * Fonte = le category per-tipo del Beyblade Fandom Wiki. I termini Lock Chip / Main Blade / Metal
 * Blade / Assist Blade / Over Blade / Ratchet / Bit sono ESCLUSIVI di Beyblade X → quelle category
 * sono X-pure e complete. SOLO `Category:Blades` è mista (X + Burst QuadDrive): per i blade si filtra
 * tenendo le pagine che appartengono anche a `Category:Beyblade X`. (NB: `Category:Beyblade X Parts`
 * è taggata in modo incompleto e NON va usata.)
 *
 * Mappa al nostro modello: Metal Blade -> mainBlade, Ratchet-Integrated Blade -> blade.
 * Output: per categoria, MANCANTI (sul wiki, non nel master) ed EXTRA (nel master, non sul wiki).
 * È il riferimento contro cui validare il registro parti — e quindi le estrazioni combo dai vari siti,
 * che risolvono i nomi sul master. Uso: `npm run verify:wiki`. Solo lettura.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const API = 'https://beyblade.fandom.com/api.php';
const masterPath = join(import.meta.dirname, '..', 'data', 'parts-master.json');
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const stripPrefix = (t: string) => (t.includes(' - ') ? t.slice(t.indexOf(' - ') + 3) : t)
  .replace(/\s*\((Hasbro|Takara Tomy)\)\s*$/i, '');

async function apiGet(params: Record<string, string>): Promise<any> {
  const u = new URL(API);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('format', 'json');
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Membri di una category (paginati). X-pure per tutti i tipi tranne "Blades".
async function catTitles(cat: string): Promise<string[]> {
  const out: string[] = [];
  let cont: string | undefined;
  do {
    const p: Record<string, string> = {
      action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`,
      cmlimit: '500', cmprop: 'title', cmnamespace: '0',
    };
    if (cont) p.cmcontinue = cont;
    const j = await apiGet(p);
    for (const m of j.query?.categorymembers ?? []) out.push(m.title);
    cont = j.continue?.cmcontinue;
  } while (cont);
  return out;
}

// Blade di Category:Blades che sono ANCHE in Category:Beyblade X (toglie i Burst QuadDrive).
async function bladesX(): Promise<string[]> {
  const out: string[] = [];
  let cont: Record<string, string> = {};
  do {
    const j = await apiGet({
      action: 'query', generator: 'categorymembers', gcmtitle: 'Category:Blades',
      gcmlimit: '200', gcmnamespace: '0', prop: 'categories',
      clcategories: 'Category:Beyblade X', cllimit: 'max', ...cont,
    });
    for (const p of Object.values<any>(j.query?.pages ?? {})) {
      if ((p.categories ?? []).some((c: any) => c.title === 'Category:Beyblade X')) out.push(p.title);
    }
    cont = j.continue ?? {};
  } while (Object.keys(cont).length);
  return out;
}

function masterKeys(arr: any[]): Set<string> {
  const s = new Set<string>();
  for (const e of arr || []) {
    s.add(norm(e.names?.tt));
    if (e.names?.hasbro) s.add(norm(e.names.hasbro));
    s.add(norm(e.id));
    for (const a of e.aliases || []) s.add(norm(a.value));
  }
  s.delete('');
  return s;
}

async function main() {
  const master = JSON.parse(readFileSync(masterPath, 'utf8'));
  const [blades, ri, locks, mains, metals, assists, overs, ratchets, bits] = await Promise.all([
    bladesX(), catTitles('Ratchet-Integrated Blades'), catTitles('Lock Chips'),
    catTitles('Main Blades'), catTitles('Metal Blades'), catTitles('Assist Blades'),
    catTitles('Over Blades'), catTitles('Ratchets'), catTitles('Bits'),
  ]);

  const groups: [string, string[], any[]][] = [
    ['blades', [...blades, ...ri], master.blades],
    ['lockChips', locks, master.lockChips],
    ['mainBlades', [...mains, ...metals], master.mainBlades],
    ['assistBlades', assists, master.assistBlades],
    ['overBlades', overs, master.overBlades],
    ['ratchets', ratchets, master.ratchets],
    ['bits', bits, master.bits],
  ];

  console.log('Fonte: category per-tipo del Fandom Wiki (Blades filtrati su Category:Beyblade X)\n');
  console.log('CATEGORIA       wiki-X  master   mancanti / extra');
  let totM = 0, totE = 0;
  for (const [label, titles, arr] of groups) {
    const wiki = new Map<string, string>();
    for (const t of titles) { const k = norm(stripPrefix(t)); if (k) wiki.set(k, t); }
    const mkeys = masterKeys(arr);
    const wkeys = new Set(wiki.keys());
    const missing = [...wiki.entries()].filter(([k]) => !mkeys.has(k)).map(([, t]) => t);
    const extra = (arr || []).filter((e: any) => {
      const c = [norm(e.names?.tt), norm(e.id), e.names?.hasbro ? norm(e.names.hasbro) : ''].filter(Boolean);
      return !c.some((x: string) => wkeys.has(x));
    }).map((e: any) => e.id);
    totM += missing.length; totE += extra.length;
    console.log(`${label.padEnd(14)} ${String(wiki.size).padStart(5)} ${String((arr || []).length).padStart(7)}    -${missing.length} / +${extra.length}`);
    if (missing.length) console.log('   MANCANTI: ' + missing.join(', '));
    if (extra.length) console.log('   EXTRA:    ' + extra.join(', '));
  }
  console.log(`\nTotale: ${totM} mancanti, ${totE} extra.`);
  if (totM === 0) console.log('Registro COMPLETO rispetto alla fonte. Gli EXTRA sono parti non a catalogo wiki (RatchetBit, varianti community, dati podio): verificare caso per caso.');
}

main().catch((e) => { console.error('verify-against-wiki fallito:', e.message); process.exit(1); });
