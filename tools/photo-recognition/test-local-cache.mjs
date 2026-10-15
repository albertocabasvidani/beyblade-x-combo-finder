/** Il riuso delle 13 fonti salvate deve riuscire anche con ogni fetch disabilitata. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sources = fileURLToPath(new URL('../../data/recognition/sources/', import.meta.url));
const files = readdirSync(sources).filter(f => f.endsWith('.json'));
const hash = f => createHash('sha256').update(readFileSync(join(sources, f))).digest('hex');
const before = new Map(files.map(f => [f, hash(f)]));
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('La cache di un prodotto già visto non deve usare la rete');
};
try {
  await import('./sync-references.mjs');
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(networkCalls, 0);
for (const f of files) assert.equal(hash(f), before.get(f), `Fonte riscritta: ${f}`);
console.log(`OK: ${files.length} fonti riusate, 0 richieste di rete, 0 fonti riscritte.`);
