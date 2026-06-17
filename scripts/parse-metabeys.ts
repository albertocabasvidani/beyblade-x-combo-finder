/**
 * parse-metabeys.ts — Estrazione DETERMINISTICA dell'evidenza torneo da metabeys-cache.json.
 *
 * MetaBeys ha formato tabellare costante: eventi (podio + deck top-cut + n° giocatori) e
 * leaderboard (appearances/share/unique events/unique players). Questo codice li parsa senza IA
 * e produce data/metabeys-evidence.json (placements + usage per comboId).
 *
 * Copre il caso BX/UX a 3 parti (Blade / Ratchet / Bit), che è il grosso del meta. Le righe CX
 * (4+ segmenti), incomplete o con nomi non risolvibili (typo) finiscono in `unresolved` per
 * gestione IA/manuale in /update-combos. Niente euristiche azzardate: il codice fa solo il certo.
 *
 * Esegui: npx tsx scripts/parse-metabeys.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { PlacementEvidence, UsageEvidence, BladeType } from '../src/lib/types';
import { isFresh, parseLongDate } from './lib/freshness';
import { buildCxResolver, resolveCxBladePart, cxComboId, cxDisplayName, type CxResolver } from './lib/cx-resolve';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const cachePath = join(DATA, 'metabeys-cache.json');
const partsPath = join(DATA, 'parts.json');
const outPath = join(DATA, 'metabeys-evidence.json');

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();

interface Resolver {
  blade: Map<string, { id: string; name: string; type: BladeType }>;
  bit: Map<string, { id: string; name: string }>;
  ratchet: Set<string>;
  cx: CxResolver;  // risolutore del lato sinistro CX (lockChip+mainBlade+assist[+over])
}

function buildResolver(): Resolver {
  const parts = JSON.parse(readFileSync(partsPath, 'utf8'));
  const blade = new Map<string, { id: string; name: string; type: BladeType }>();
  for (const b of parts.blades) {
    const v = { id: b.id, name: b.name, type: b.type as BladeType };
    blade.set(norm(b.name), v);
    if (b.nameWestern) blade.set(norm(b.nameWestern), v);
  }
  const bit = new Map<string, { id: string; name: string }>();
  for (const b of parts.bits) bit.set(norm(b.name), { id: b.id, name: b.name });
  const ratchet = new Set<string>(parts.ratchets.map((r: any) => r.id));
  return { blade, bit, ratchet, cx: buildCxResolver(parts) };
}

interface ComboAcc {
  id: string; line: 'bx' | 'cx';
  blade: string | null; ratchet: string; bit: string;
  lockChip?: string | null; mainBlade?: string | null; assistBlade?: string | null; overBlade?: string | null;
  displayName: string; type: BladeType;
  placements: PlacementEvidence[]; usage: UsageEvidence[];
}

const combos = new Map<string, ComboAcc>();
const unresolved: { line: string; reason: string; ctx?: string }[] = [];

function ensure(r: Resolver, bladeName: string, ratchet: string, bitName: string): ComboAcc | null {
  const b = r.blade.get(norm(bladeName));
  const bit = r.bit.get(norm(bitName));
  if (!b) { return null; }
  if (!r.ratchet.has(ratchet)) { return null; }
  if (!bit) { return null; }
  const id = `${b.id}-${ratchet}-${bit.id}`;
  let acc = combos.get(id);
  if (!acc) {
    acc = { id, line: 'bx', blade: b.id, ratchet, bit: bit.id,
      lockChip: null, mainBlade: null, assistBlade: null, overBlade: null,
      displayName: `${b.name} ${ratchet} ${bit.name}`, type: b.type, placements: [], usage: [] };
    combos.set(id, acc);
  }
  return acc;
}

/**
 * CX a 4 segmenti MetaBeys: "lockChip mainBlade [overBlade] / assist / ratchet / bit"
 * (es. "Pegasus Blast / Heavy / 9-60 / Low Rush", "Hells Rage Flow / Heavy / 1-50 / Rush").
 * Riusa cx-resolve componendo `seg[0] + ' ' + seg[1]` come lato sinistro CX (order-agnostic, Western).
 */
function ensureCx(r: Resolver, core: string, assist: string, ratchet: string, bitName: string): ComboAcc | null {
  if (!r.ratchet.has(ratchet)) return null;
  const bit = r.bit.get(norm(bitName));
  if (!bit) return null;
  const res = resolveCxBladePart(r.cx, `${core} ${assist}`);
  if (!res.ok) return null;
  const cx = res.cx;
  const id = cxComboId(cx, ratchet, bit.id);
  let acc = combos.get(id);
  if (!acc) {
    acc = {
      id, line: 'cx', blade: null, ratchet, bit: bit.id,
      lockChip: cx.lockChip.id, mainBlade: cx.mainBlade.id, assistBlade: cx.assistBlade.id,
      overBlade: cx.overBlade ? cx.overBlade.id : null,
      displayName: cxDisplayName(cx, ratchet, bit.name), type: (cx.mainBlade.type as BladeType) ?? 'balance',
      placements: [], usage: [],
    };
    combos.set(id, acc);
  }
  return acc;
}

/** Risolve una riga deck: BX "Blade / Ratchet / Bit" (3 seg) o CX "core / assist / ratchet / bit" (4 seg). */
function resolveDeckLine(r: Resolver, line: string, ctx: string): ComboAcc | null {
  const seg = line.split('/').map((s) => s.trim());
  if (seg.length === 3) {
    if (!seg[0] || !seg[1] || !seg[2]) { unresolved.push({ line, reason: 'segmento vuoto (incompleto)', ctx }); return null; }
    const acc = ensure(r, seg[0], seg[1], seg[2]);
    if (!acc) unresolved.push({ line, reason: 'nome parte non risolto', ctx });
    return acc;
  }
  if (seg.length === 4) {
    if (seg.some((s) => !s)) { unresolved.push({ line, reason: 'segmento vuoto (incompleto)', ctx }); return null; }
    const acc = ensureCx(r, seg[0], seg[1], seg[2], seg[3]);
    if (!acc) unresolved.push({ line, reason: 'CX non risolta (nome/sigla non nel registro o ambigua)', ctx });
    return acc;
  }
  unresolved.push({ line, reason: `segmenti=${seg.length} (malformato)`, ctx });
  return null;
}

const PLACEMENT_RE = /^(\d+)(?:st|nd|rd|th)\s*[—–-]\s*(.+)$/;

function parseEvent(r: Resolver, evt: { id: string; url: string; raw: string }) {
  const raw = evt.raw;
  const date = parseLongDate(raw);
  if (!date) { unresolved.push({ line: `event ${evt.id}`, reason: 'data non parsata' }); return; }
  // Cutoff condiviso: gli eventi più vecchi di 12 mesi non entrano nell'evidenza (decay già ~0).
  if (!isFresh(date)) { unresolved.push({ line: `event ${evt.id}`, reason: `oltre-cutoff (${date})` }); return; }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  const playersIdx = lines.findIndex((l) => /^\d+\s+players$/i.test(l));
  const players = playersIdx >= 0 ? parseInt(lines[playersIdx].match(/^(\d+)/)![1], 10) : undefined;
  const eventName = playersIdx > 0 ? lines[playersIdx - 1] : evt.id;
  const tcLine = lines.find((l) => /^Top Cut\s+\d+$/i.test(l));
  const topCutSize = tcLine ? parseInt(tcLine.match(/(\d+)/)![1], 10) : undefined;

  // Parsa solo la sezione "Top Cut Entrants" (ha i deck); il "Podium" non ha combo.
  let start = lines.findIndex((l) => /^Top Cut Entrants/i.test(l));
  if (start < 0) start = 0;

  let placement = 0;
  let deckScore: string | undefined;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^Join our Discord$/i.test(l) || /^Support MetaBeys$/i.test(l)) break;
    const pm = l.match(PLACEMENT_RE);
    if (pm) { placement = parseInt(pm[1], 10); deckScore = undefined; continue; }
    if (/^Deck Score:?$/i.test(l)) { deckScore = lines[i + 1]; continue; }
    if (/^Note:/i.test(l)) continue;
    if (!l.includes('/')) continue;
    if (placement === 0) continue;
    const acc = resolveDeckLine(r, l, `${evt.id} ${placement}°`);
    if (acc) {
      acc.placements.push({
        source: 'metabeys', tier: 'structured', eventId: evt.id, eventName, date,
        placement, topCutSize, players,
        deckScore: deckScore && /^[SABCD]$/.test(deckScore) ? deckScore : undefined,
        lang: 'en', url: evt.url,
      });
    }
  }
}

function parseLeaderboard(r: Resolver, leaderboard: string, snapshotDate: string) {
  const tokens = leaderboard.split(/[\t\n]+/).map((t) => t.trim()).filter(Boolean);
  let count = 0;
  for (let i = 1; i < tokens.length - 4; i++) {
    const t = tokens[i];
    const rb = t.match(/^(.+?) • (.+)$/);            // token distintivo "ratchet • bit"
    if (!rb) continue;
    const ratchet = rb[1].trim();
    if (!r.ratchet.has(ratchet)) continue;            // conferma che è davvero un ratchet
    const bladeName = tokens[i - 1];
    const bitName = rb[2].trim();
    const appearances = tokens[i + 1], share = tokens[i + 2], ue = tokens[i + 3], up = tokens[i + 4];
    if (!/^[\d,]+$/.test(appearances) || !/%$/.test(share) || !/^[\d,]+$/.test(ue) || !/^[\d,]+$/.test(up)) continue;
    const acc = ensure(r, bladeName, ratchet, bitName);
    if (!acc) { unresolved.push({ line: `${bladeName} / ${ratchet} / ${bitName}`, reason: 'leaderboard: nome non risolto' }); continue; }
    acc.usage.push({
      source: 'metabeys-leaderboard', date: snapshotDate, window: '30d',
      appearances: parseInt(appearances.replace(/,/g, ''), 10),
      sharePct: parseFloat(share),
      uniqueEvents: parseInt(ue.replace(/,/g, ''), 10),
      uniquePlayers: parseInt(up.replace(/,/g, ''), 10),
      lang: 'en',
    });
    count++;
  }
  return count;
}

function main() {
  if (!existsSync(cachePath)) { console.error('metabeys-cache.json mancante. Esegui npm run fetch:metabeys.'); process.exit(1); }
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const r = buildResolver();

  for (const evt of cache.events ?? []) parseEvent(r, evt);
  const lbCount = cache.leaderboard ? parseLeaderboard(r, cache.leaderboard, cache.lastFetched ?? '') : 0;

  const out = {
    generatedAt: cache.lastFetched ?? '',
    source: 'metabeys',
    combos: Object.fromEntries([...combos.values()].map((c) => [c.id, c])),
    unresolved,
    stats: {
      events: (cache.events ?? []).length,
      combosResolved: combos.size,
      placements: [...combos.values()].reduce((n, c) => n + c.placements.length, 0),
      usageRows: lbCount,
      unresolved: unresolved.length,
    },
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`parse-metabeys: ${out.stats.combosResolved} combo, ${out.stats.placements} piazzamenti, ${out.stats.usageRows} righe usage, ${out.stats.unresolved} non risolte.`);
  console.log(`→ ${outPath}`);
}

main();
