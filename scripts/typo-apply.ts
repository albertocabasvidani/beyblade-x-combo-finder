/**
 * typo-apply.ts — Gate deterministico + merge delle correzioni typo proposte dal subagent.
 *
 * Input: tmp/typo-corrected.json = [{ key, line, correctedLine }] prodotto dal subagent di
 * /update-combos. Per ogni proposta applica il GATE: la `correctedLine` deve risolvere con
 * parseComboLine (id valido). Solo le proposte che passano il gate vengono fuse in
 * data/wbo-corrections.json (chiave = norm(line originale)). Le altre sono scartate e segnalate.
 * Idempotente. Nessuna IA qui: solo verifica e scrittura.
 *
 * Esegui: npx tsx scripts/typo-apply.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildResolver, parseComboLine } from './lib/wbo-parse';
import { normLineOf } from './lib/wbo-unresolved';

const ROOT = join(import.meta.dirname, '..');
const inPath = join(ROOT, 'tmp', 'typo-corrected.json');
const correctionsPath = join(ROOT, 'data', 'wbo-corrections.json');
const today = () => new Date().toISOString().slice(0, 10);

if (!existsSync(inPath)) { console.error('tmp/typo-corrected.json mancante (output del subagent typo).'); process.exit(1); }
const proposals: Array<{ key?: string; line: string; correctedLine: string }> = JSON.parse(readFileSync(inPath, 'utf8'));

const r = buildResolver();
const existing = existsSync(correctionsPath) ? JSON.parse(readFileSync(correctionsPath, 'utf8')) : { corrections: {} };
const corrections: Record<string, string> = existing.corrections ?? {};

let accepted = 0, rejected = 0;
for (const p of proposals) {
  if (!p.line || !p.correctedLine) { rejected++; continue; }
  const res = parseComboLine(r, p.correctedLine);
  if (res.ok) { corrections[normLineOf(p.line)] = p.correctedLine; accepted++; }
  else { rejected++; console.warn(`  scartata (non risolve): "${p.line}" → "${p.correctedLine}" (${res.reason})`); }
}

const sorted: Record<string, string> = {};
for (const k of Object.keys(corrections).sort()) sorted[k] = corrections[k];
writeFileSync(correctionsPath, JSON.stringify({ generatedAt: today(), note: existing.note ?? '', corrections: sorted }, null, 2) + '\n');
console.log(`typo-apply: ${accepted} correzioni accettate (gate OK), ${rejected} scartate. Totale attive: ${Object.keys(sorted).length}. → ${correctionsPath}`);
console.log('Riesegui npm run parse:wbo per applicarle in contesto (le righe corrette spariranno dal ledger).');
