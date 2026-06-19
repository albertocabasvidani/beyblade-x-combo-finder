/**
 * enrich-stats.ts — Arricchimento one-off: aggiunge le stat ATK/DEF/STA alle parti nel master,
 * prese dall'infobox delle pagine Fandom DEDICATE (Category:Blades / Bits / Ratchets / Main Blades).
 *
 * NON tocca i comandi agentici daily. Scrive `stats: {atk,def,sta}` dentro data/parts-master.json
 * (merge-master preserva i campi extra → sopravvivono ai run giornalieri). Poi `npm run build:parts`
 * propaga le stat in parts.json (pass-through già presente in build-parts.ts).
 *
 * Imposta le stat solo quando TUTTE e 3 sono presenti e numeriche nell'infobox; altrimenti la parte
 * resta senza `stats` (degradazione lato consumatori). Uso: npm run enrich:stats
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const masterPath = join(ROOT, 'data', 'parts-master.json');
const API = 'https://beyblade.fandom.com/api.php';
const UA = 'beyblade-x-combo-finder stats-enrichment (one-off)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet(params: Record<string, string>): Promise<any> {
  const u = new URL(API);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('format', 'json');
  const res = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${u}`);
  return res.json();
}

async function catTitles(cat: string): Promise<string[]> {
  const out: string[] = [];
  let cont: string | undefined;
  do {
    const p: Record<string, string> = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${cat}`,
      cmlimit: '500',
      cmprop: 'title',
      cmnamespace: '0',
    };
    if (cont) p.cmcontinue = cont;
    const j = await apiGet(p);
    for (const m of j.query?.categorymembers ?? []) out.push(m.title);
    cont = j.continue?.cmcontinue;
    await sleep(150);
  } while (cont);
  return out;
}

async function fetchContents(titles: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const j = await apiGet({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: batch.join('|'),
    });
    const pages = j.query?.pages ?? {};
    for (const k of Object.keys(pages)) {
      const pg = pages[k];
      const rev = pg?.revisions?.[0];
      const content = rev?.slots?.main?.['*'] ?? rev?.['*'];
      if (pg?.title && content) map.set(pg.title, content);
    }
    await sleep(150);
  }
  return map;
}

function parseStats(wt: string): { atk: number; def: number; sta: number } | null {
  const num = (re: RegExp) => {
    const m = wt.match(re);
    return m ? parseInt(m[1], 10) : NaN;
  };
  const atk = num(/\|\s*AttackStat\s*=\s*(\d+)/i);
  const def = num(/\|\s*DefenseStat\s*=\s*(\d+)/i);
  const sta = num(/\|\s*StaminaStat\s*=\s*(\d+)/i);
  if (Number.isFinite(atk) && Number.isFinite(def) && Number.isFinite(sta)) return { atk, def, sta };
  return null;
}

const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const stripPrefix = (title: string) => {
  const i = title.indexOf(' - ');
  return i >= 0 ? title.slice(i + 3) : title;
};

async function buildStatsMap(cat: string): Promise<Map<string, { atk: number; def: number; sta: number }>> {
  const titles = await catTitles(cat);
  const contents = await fetchContents(titles);
  const map = new Map<string, { atk: number; def: number; sta: number }>();
  for (const [title, wt] of contents) {
    const stats = parseStats(wt);
    if (stats) map.set(norm(stripPrefix(title)), stats);
  }
  console.log(`[${cat}] ${titles.length} pagine, ${map.size} con stat complete (ATK/DEF/STA)`);
  return map;
}

function applyToCategory(parts: any[] | undefined, statsMap: Map<string, { atk: number; def: number; sta: number }>): number {
  let n = 0;
  for (const p of parts ?? []) {
    const keys = [norm(p.names?.tt), norm(p.names?.hasbro), norm(p.id)].filter(Boolean);
    for (const k of keys) {
      const stats = statsMap.get(k);
      if (stats) {
        p.stats = stats;
        n++;
        break;
      }
    }
  }
  return n;
}

async function main() {
  const master = JSON.parse(readFileSync(masterPath, 'utf8'));

  const bladeMap = await buildStatsMap('Blades');
  const bitMap = await buildStatsMap('Bits');
  const ratchetMap = await buildStatsMap('Ratchets');
  const mainBladeMap = await buildStatsMap('Main Blades');

  const nb = applyToCategory(master.blades, bladeMap);
  const nbit = applyToCategory(master.bits, bitMap);
  const nr = applyToCategory(master.ratchets, ratchetMap);
  const nm = applyToCategory(master.mainBlades, mainBladeMap);

  writeFileSync(masterPath, JSON.stringify(master, null, 2) + '\n');

  console.log('\n=== Stat applicate al master ===');
  console.log(`blade:      ${nb}/${master.blades?.length ?? 0}`);
  console.log(`bit:        ${nbit}/${master.bits?.length ?? 0}`);
  console.log(`ratchet:    ${nr}/${master.ratchets?.length ?? 0}`);
  console.log(`main blade: ${nm}/${master.mainBlades?.length ?? 0}`);
  console.log('\nOra esegui: npm run build:parts');
}

main();
