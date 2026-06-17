/**
 * typo-candidates.ts — Prepara l'INPUT del subagent typo di /update-combos (Fase IA sul confine).
 *
 * Estrae dal ledger (data/wbo-unresolved.json) le righe-refuso da triagiare (status "new", categoria
 * blade-unresolved/bit-unresolved) e la lista totale dei nomi del registro (parts.json). Il subagent
 * economico legge questo file, propone per ogni riga la versione corretta (token più vicino del
 * registro) e la scrive in tmp/typo-corrected.json; poi `typo-apply.ts` la gate-verifica e la fonde in
 * data/wbo-corrections.json. Nessuna IA qui: solo estrazione deterministica.
 *
 * Esegui: npx tsx scripts/typo-candidates.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const ledgerPath = join(DATA, 'wbo-unresolved.json');
const partsPath = join(DATA, 'parts.json');
const outPath = join(ROOT, 'tmp', 'typo-candidates.json');

const TRIAGE = new Set(['blade-unresolved', 'bit-unresolved']);

function registryNames(parts: any): Array<{ id: string; category: string; names: string[] }> {
  const out: Array<{ id: string; category: string; names: string[] }> = [];
  const push = (id: string, category: string, names: Array<string | undefined>) =>
    out.push({ id, category, names: [...new Set(names.filter(Boolean) as string[])] });
  for (const p of parts.blades ?? []) push(p.id, 'blade', [p.name, p.nameWestern, ...(p.aliases ?? [])]);
  for (const p of parts.lockChips ?? []) push(p.id, 'lockChip', [p.name, p.nameWestern]);
  for (const p of parts.mainBlades ?? []) push(p.id, 'mainBlade', [p.name, p.nameWestern]);
  for (const p of parts.assistBlades ?? []) push(p.id, 'assistBlade', [p.name, p.shortName]);
  for (const p of parts.overBlades ?? []) push(p.id, 'overBlade', [p.name, p.nameWestern]);
  for (const p of parts.ratchets ?? []) push(p.id, 'ratchet', [p.name]);
  for (const p of parts.bits ?? []) push(p.id, 'bit', [p.name, p.shortName, ...(p.aliases ?? [])]);
  return out;
}

if (!existsSync(ledgerPath)) { console.error('wbo-unresolved.json mancante. Esegui prima npm run parse:wbo.'); process.exit(1); }
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const parts = JSON.parse(readFileSync(partsPath, 'utf8'));

const candidates = (ledger.items ?? [])
  .filter((i: any) => i.status === 'new' && TRIAGE.has(i.category))
  .map((i: any) => ({ key: i.key, line: i.line, reason: i.reason, category: i.category, occurrences: i.occurrences }));

writeFileSync(outPath, JSON.stringify({ candidates, registry: registryNames(parts) }, null, 2) + '\n');
console.log(`typo-candidates: ${candidates.length} righe da triagiare → tmp/typo-candidates.json`);
