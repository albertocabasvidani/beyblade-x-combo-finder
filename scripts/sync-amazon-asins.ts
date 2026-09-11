/**
 * sync-amazon-asins.ts — estrae gli ASIN per codice prodotto dallo stato del progetto sorella
 * bbxdealmonitor e scrive data/amazon-asins.json (deterministico, idempotente, ordinato per chiave).
 *
 * Sorgente: `state/seen.json` del monitor, struttura
 *   { amazon: { <mercato it|de|es|jp|fr|uk>: { "BX-49": { asin, title, … }, "asin:B0…": { … } } } }
 * Si tengono solo le chiavi che sono codici prodotto (^(BX|UX|CX)-\d+$): le chiavi "asin:…" sono
 * offerte senza codice riconosciuto e non servono ai link per parte.
 *
 * Path sorgente: env BBX_SEEN_PATH, default ../bbxdealmonitor/state/seen.json (sul homeserver i due
 * progetti stanno fianco a fianco in C:\Users\server\progetti). File assente → avviso ed exit 0: il
 * sito ripiega sulla ricerca Amazon, non è un errore.
 *
 * Esegui: npm run sync:amazon-asins   (dentro /update-parts, dopo sync:part-images)
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'data', 'amazon-asins.json');
const SRC = resolve(ROOT, process.env.BBX_SEEN_PATH ?? join('..', 'bbxdealmonitor', 'state', 'seen.json'));
const CODE_RE = /^(BX|UX|CX)-\d+$/;

function main() {
  if (!existsSync(SRC)) {
    console.log(`sync-amazon-asins: sorgente assente (${SRC}); data/amazon-asins.json lasciato com'e'. Il sito usa la ricerca Amazon.`);
    return;
  }
  const seen = JSON.parse(readFileSync(SRC, 'utf8'));
  const markets: Record<string, Record<string, any>> = seen.amazon ?? {};
  const index: Record<string, Record<string, string>> = {};
  const perMarket: Record<string, number> = {};
  for (const [market, entries] of Object.entries(markets)) {
    perMarket[market] = 0;
    for (const [key, e] of Object.entries(entries ?? {})) {
      if (!CODE_RE.test(key)) continue;
      const asin = (e as any)?.asin;
      if (typeof asin !== 'string' || !/^B0[A-Z0-9]{8}$/.test(asin)) continue;
      (index[key] ??= {})[market] = asin;
      perMarket[market]++;
    }
  }
  const sorted = Object.fromEntries(
    Object.keys(index).sort().map((k) => [k, Object.fromEntries(Object.keys(index[k]).sort().map((m) => [m, index[k][m]]))]),
  );
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');

  // Copertura: quante parti del registro hanno almeno un ASIN (via codice set) su almeno un mercato.
  const products = JSON.parse(readFileSync(join(ROOT, 'data', 'products.json'), 'utf8'));
  const flat: any[] = [];
  for (const man of Object.values<any>(products.products ?? {})) for (const v of Object.values<any>(man)) if (Array.isArray(v)) flat.push(...v);
  const covered = new Set<string>();
  for (const p of flat) {
    if (!sorted[p.code]) continue;
    for (const k of ['blade', 'lockChip', 'mainBlade', 'assistBlade', 'overBlade', 'ratchet', 'bit']) if (p[k]) covered.add(`${k}:${p[k]}`);
  }
  console.log(`sync-amazon-asins: ${Object.keys(sorted).length} codici prodotto con ASIN, per mercato ${JSON.stringify(perMarket)}; parti coperte da almeno un ASIN: ${covered.size}. Scritto ${OUT}`);
}

main();
