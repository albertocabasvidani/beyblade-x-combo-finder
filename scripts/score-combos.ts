/**
 * score-combos.ts — Applica l'evidenza ai combo e ricalcola lo score CAS (deterministico).
 *
 * Sorgenti di evidenza:
 *  - data/metabeys-evidence.json (parser deterministico, placements + usage) → struttura il meta.
 *  - sources[] legacy di combos.json → ripiegati in `mentions` (solo corroboration, nessun
 *    placement inventato), per non perdere i combo non coperti dai dati torneo correnti.
 *
 * Ricalcola TUTTI i combo così lo scoreBreakdown è uniforme (nuovo schema) su tutto il DB.
 * Lo scoring NON lo fa l'IA: questa è la trasformazione evidence→numero, in src/lib/scoring.ts.
 *
 * Esegui: npx tsx scripts/score-combos.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { scoreCombo } from '../src/lib/scoring';
import type { Combo, CombosDatabase, ComboEvidence, MentionEvidence } from '../src/lib/types';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const combosPath = join(DATA, 'combos.json');
const evidencePath = join(DATA, 'metabeys-evidence.json');

const today = () => new Date().toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Tag gestiti dallo scoring: vengono rigenerati, gli altri (manuali) si preservano.
const MANAGED_TAGS = new Set(['meta', 'top-tier', 'tournament-proven', 'theory-only', 'rising']);

function legacyMentions(combo: Combo): MentionEvidence[] {
  const out: MentionEvidence[] = [];
  const seen = new Set<string>();
  for (const s of combo.sources ?? []) {
    if (/metabeys/i.test(s.name)) continue;        // già coperto dall'evidenza parsata
    const id = slug(s.name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ source: id, date: s.date || today(), kind: 'recommendation', lang: 'en', url: s.url });
  }
  return out;
}

function main() {
  if (!existsSync(combosPath)) { console.error('combos.json mancante.'); process.exit(1); }
  const db: CombosDatabase = JSON.parse(readFileSync(combosPath, 'utf8'));
  const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : { combos: {} };
  const parsed: Record<string, any> = evidence.combos ?? {};

  const byId = new Map<string, Combo>(db.combos.map((c) => [c.id, c]));

  // 1) Crea i combo nuovi trovati dal parser (non ancora in combos.json).
  let created = 0;
  for (const [id, ev] of Object.entries(parsed)) {
    if (byId.has(id)) continue;
    const c: Combo = {
      id, line: ev.line, blade: ev.blade, ratchet: ev.ratchet, bit: ev.bit,
      lockChip: null, mainBlade: null, assistBlade: null, overBlade: null,
      displayName: ev.displayName, type: ev.type,
      score: 0, scoreBreakdown: { performance: 0, presence: 0, corroboration: 0, tournamentEvents: 0, wins: 0, topCutAppearances: 0 },
      tags: [], notes: '', sources: [],
      dateAdded: today(), dateUpdated: today(),
    };
    db.combos.push(c);
    byId.set(id, c);
    created++;
  }

  // 2) Costruisci evidence per OGNI combo e ricalcola lo score.
  const ref = new Date();
  let rescored = 0;
  for (const combo of db.combos) {
    const p = parsed[combo.id];
    const prevMentions = combo.evidence?.mentions ?? [];
    const ev: ComboEvidence = {
      placements: p?.placements ?? combo.evidence?.placements ?? [],
      usage: p?.usage ?? combo.evidence?.usage ?? [],
      mentions: dedupMentions([...prevMentions, ...legacyMentions(combo)]),
    };
    combo.evidence = ev;

    const { score, breakdown, tags } = scoreCombo(ev, { ref });
    const manualTags = (combo.tags ?? []).filter((t) => !MANAGED_TAGS.has(t));
    combo.score = score;
    combo.scoreBreakdown = breakdown;
    combo.tags = [...new Set([...tags, ...manualTags])];
    combo.dateUpdated = today();

    // sources[] per i combo nuovi: derivali dall'evidenza (per i link in UI).
    if ((combo.sources ?? []).length === 0) combo.sources = sourcesFromEvidence(ev);
    rescored++;
  }

  db.combos.sort((a, b) => b.score - a.score);
  db.lastUpdated = new Date().toISOString();
  writeFileSync(combosPath, JSON.stringify(db, null, 2) + '\n');

  console.log(`score-combos: ${rescored} combo ricalcolati, ${created} nuovi creati.`);
  console.log('\nTop 15 per CAS:');
  for (const c of db.combos.slice(0, 15)) {
    const b = c.scoreBreakdown;
    console.log(`  ${c.score.toFixed(1).padStart(4)}  ${c.displayName.padEnd(34)} perf=${b.performance} pres=${b.presence} corr=${b.corroboration}  [${b.wins}W/${b.tournamentEvents}ev]`);
  }
}

function dedupMentions(ms: MentionEvidence[]): MentionEvidence[] {
  const seen = new Set<string>();
  const out: MentionEvidence[] = [];
  for (const m of ms) { if (seen.has(m.source)) continue; seen.add(m.source); out.push(m); }
  return out;
}

function sourcesFromEvidence(ev: ComboEvidence) {
  const out: { name: string; url: string; weight: number; date: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, url: string, weight: number, date: string) => {
    if (seen.has(name)) return; seen.add(name); out.push({ name, url, weight, date });
  };
  for (const u of ev.usage) push('MetaBeys Leaderboard', 'https://www.metabeys.com/leaderboard', 1, u.date);
  for (const p of ev.placements) push(`MetaBeys — ${p.eventName}`, p.url ?? 'https://www.metabeys.com', 1, p.date);
  return out.slice(0, 12);
}

main();
