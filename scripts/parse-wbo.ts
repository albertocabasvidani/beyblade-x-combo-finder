/**
 * parse-wbo.ts — Entry-point del parser WBO deterministico (nessuna IA, nessuna API).
 *
 * Legge data/wbo-cache.json (raw del thread "Winning Combinations"), segmenta il thread e risolve le
 * combo BX in modo deterministico, e scrive data/wbo-evidence.json (placements per comboId), nello
 * stesso schema di metabeys-evidence.json.
 *
 * Esegui: npx tsx scripts/parse-wbo.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildResolver, assembleEvidence, segmentThread, SOURCE_ID, type WboEvidence } from './lib/wbo-parse';
import { loadLedger, mergeUnresolved, writeLedger } from './lib/wbo-unresolved';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const cachePath = join(DATA, 'wbo-cache.json');
const outPath = join(DATA, 'wbo-evidence.json');
const ledgerPath = join(DATA, 'wbo-unresolved.json');
const correctionsPath = join(DATA, 'wbo-corrections.json');
const today = () => new Date().toISOString().slice(0, 10);

/** Mappa correzioni typo (norm(riga) → riga corretta), curata dal subagent di /update-combos. */
function loadCorrections(): Record<string, string> {
  if (!existsSync(correctionsPath)) return {};
  try {
    const c = JSON.parse(readFileSync(correctionsPath, 'utf8'));
    return c.corrections ?? {};
  } catch { return {}; }
}

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

  const resolver = buildResolver();
  const events = segmentThread(raw, resolver);
  const evidence = assembleEvidence(events, resolver, fetchedAt, sourceUrl, loadCorrections());
  writeEvidence(evidence, fetchedAt);

  // Ledger persistente degli unresolved: aggiorna lo stato e segnala solo il delta nuovo mai visto.
  const stamp = today();
  const { ledger, added } = mergeUnresolved(loadLedger(ledgerPath, SOURCE_ID), evidence.unresolved, stamp);
  writeLedger(ledgerPath, ledger);

  const s = evidence.stats;
  console.log(
    `parse-wbo: ${s.combosResolved} combo, ${s.placements} piazzamenti, ` +
    `${s.eventsWithPodium}/${s.events} eventi con podio, ${s.unresolved} non risolte.`,
  );
  console.log(
    `ledger unresolved: ${ledger.stats.total} totali ` +
    `(${added} nuovi mai visti, ${ledger.stats.triaged} triaged, ${ledger.stats.ignored} ignored). → ${ledgerPath}`,
  );
  console.log(`→ ${outPath}`);
}

main();
