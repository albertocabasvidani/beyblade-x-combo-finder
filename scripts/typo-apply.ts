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
import { normLineOf, keyOf, loadLedger, writeLedger } from './lib/wbo-unresolved';

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
const acceptedKeys = new Set<string>();
for (const p of proposals) {
  if (!p.line || !p.correctedLine) { rejected++; continue; }
  const res = parseComboLine(r, p.correctedLine);
  if (res.ok) { corrections[normLineOf(p.line)] = p.correctedLine; acceptedKeys.add(keyOf(normLineOf(p.line))); accepted++; }
  else { rejected++; console.warn(`  scartata (non risolve): "${p.line}" → "${p.correctedLine}" (${res.reason})`); }
}

// Delta vero: i candidati serviti al modello (tmp/typo-candidates.json) che non hanno avuto una
// correzione accettata passano a `triaged` nel ledger, così typo-candidates non li ripropone ogni
// notte (prima di questo passo tornavano ogni volta tutte le righe `new`: 51 su 60 nel clone locale del
// 05/11/2026).
// Le accettate restano `new`: spariscono dal ledger al prossimo parse:wbo, perché ora risolvono.
const candidatesPath = join(ROOT, 'tmp', 'typo-candidates.json');
const ledgerPath = join(ROOT, 'data', 'wbo-unresolved.json');
let triaged = 0;
if (existsSync(candidatesPath) && existsSync(ledgerPath)) {
  const served = new Set<string>((JSON.parse(readFileSync(candidatesPath, 'utf8')).candidates ?? []).map((c: any) => c.key));
  const ledger = loadLedger(ledgerPath, 'wbo');
  for (const item of ledger.items) {
    if (item.status === 'new' && served.has(item.key) && !acceptedKeys.has(item.key)) { item.status = 'triaged'; triaged++; }
  }
  ledger.stats = {
    total: ledger.items.length,
    new: ledger.items.filter((i) => i.status === 'new').length,
    triaged: ledger.items.filter((i) => i.status === 'triaged').length,
    ignored: ledger.items.filter((i) => i.status === 'ignored').length,
  };
  writeLedger(ledgerPath, ledger);
}

const sorted: Record<string, string> = {};
for (const k of Object.keys(corrections).sort()) sorted[k] = corrections[k];
writeFileSync(correctionsPath, JSON.stringify({ generatedAt: today(), note: existing.note ?? '', corrections: sorted }, null, 2) + '\n');
console.log(`typo-apply: ${accepted} correzioni accettate (gate OK), ${rejected} scartate. Totale attive: ${Object.keys(sorted).length}. → ${correctionsPath}`);
console.log(`typo-apply: ${triaged} candidati senza correzione marcati triaged nel ledger (non torneranno domani).`);
console.log('Riesegui npm run parse:wbo per applicarle in contesto (le righe corrette spariranno dal ledger).');
