/**
 * parse-wbo.ts — Entry-point del parser WBO (ibrido: segmentazione Haiku + risoluzione deterministica).
 *
 * Legge data/wbo-cache.json (raw del thread "Winning Combinations"), segmenta il layout via Haiku
 * (fallback deterministico), risolve le combo BX in modo deterministico e scrive
 * data/wbo-evidence.json (placements per comboId), nello stesso schema di metabeys-evidence.json.
 *
 * Esegui: npx tsx scripts/parse-wbo.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildResolver, assembleEvidence, SOURCE_ID, type WboEvidence } from './lib/wbo-parse';
import { segment } from './lib/wbo-segment';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const cachePath = join(DATA, 'wbo-cache.json');
const segCachePath = join(DATA, 'wbo-segmentation-cache.json');
const outPath = join(DATA, 'wbo-evidence.json');

function writeEvidence(evidence: WboEvidence, generatedAt: string) {
  const out = {
    generatedAt,
    source: SOURCE_ID,
    combos: evidence.combos,
    unresolved: evidence.unresolved,
    stats: evidence.stats,
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
}

const EMPTY: WboEvidence = {
  combos: {},
  unresolved: [],
  stats: { events: 0, eventsWithPodium: 0, combosResolved: 0, placements: 0, unresolved: 0 },
};

async function main() {
  if (!existsSync(cachePath)) {
    console.error('wbo-cache.json mancante. Esegui npm run fetch:wbo (o collect:sources).');
    process.exit(1);
  }
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const thread = cache.threads?.['bbx-winning'] ?? {};
  const raw: string = thread.raw ?? '';
  const fetchedAt: string = thread.fetchedAt ?? cache.lastFetched ?? '';
  const sourceUrl: string = thread.url ?? 'https://worldbeyblade.org/';

  // No-op pulito se la fonte è vuota o bloccata (Cloudflare blocca WBO in headless: caso comune).
  if (!raw || thread.blocked) {
    writeEvidence(EMPTY, fetchedAt);
    console.log(`parse-wbo: raw ${thread.blocked ? 'bloccato' : 'vuoto'} → evidence vuota (no-op). → ${outPath}`);
    return;
  }

  const { events, source } = await segment(raw, segCachePath);
  const resolver = buildResolver();
  const evidence = assembleEvidence(events, resolver, fetchedAt, sourceUrl);
  writeEvidence(evidence, fetchedAt);

  const s = evidence.stats;
  console.log(
    `parse-wbo (segmentazione: ${source}): ${s.combosResolved} combo, ${s.placements} piazzamenti, ` +
    `${s.eventsWithPodium}/${s.events} eventi con podio, ${s.unresolved} non risolte.`,
  );
  console.log(`→ ${outPath}`);
}

main();
