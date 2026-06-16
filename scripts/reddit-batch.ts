/**
 * reddit-batch.ts — Alimenta il mining Reddit a blocchi, idempotente via scan-history.
 *
 * `data/reddit-cache.json` è troppo grande (migliaia di righe) per un singolo Read: /update-combos
 * altrimenti lo skimma. Questo script serve all'IA un blocco di post NON ancora scansionati
 * (`scan-history.scannedRedditPosts`) in `tmp/reddit-mining-batch.json` (piccolo, 1 Read), poi marca
 * il blocco come scansionato quando l'IA ha finito. Un loop esterno chiama `next`/`done` finché
 * "Rimanenti" = 0. Funziona uguale per un backfill (~900 post → molti blocchi) e per la marcia normale
 * (pochi post nuovi/giorno → 1 blocco). La verità su cosa è già fatto è scan-history: ri-eseguire non
 * duplica.
 *
 * Uso:
 *   npx tsx scripts/reddit-batch.ts next [--size 60]   → scrive il prossimo blocco, stampa i rimanenti
 *   npx tsx scripts/reddit-batch.ts done               → marca scansionati gli id del blocco corrente
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'reddit-cache.json');
const HIST = join(ROOT, 'data', 'scan-history.json');
const BATCH = join(ROOT, 'tmp', 'reddit-mining-batch.json');

const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p: string, fb: any) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : fb);

function cmdNext(size: number) {
  const cache = readJson(CACHE, { posts: [] });
  const scanned = readJson(HIST, {}).scannedRedditPosts ?? {};
  const pending = (cache.posts ?? []).filter((p: any) => !scanned[p.id]);
  const batch = pending.slice(0, size);
  mkdirSync(dirname(BATCH), { recursive: true });
  writeFileSync(BATCH, JSON.stringify({ servedAt: today(), posts: batch }, null, 2));
  console.log(`Blocco servito: ${batch.length} post in ${BATCH}`);
  console.log(`Rimanenti non scansionati: ${pending.length - batch.length} (su ${(cache.posts ?? []).length} in cache)`);
}

function cmdDone() {
  const batch = readJson(BATCH, { posts: [] });
  if (!batch.posts?.length) {
    console.log('Nessun blocco corrente da marcare.');
    return;
  }
  const hist = readJson(HIST, {});
  hist.scannedRedditPosts = hist.scannedRedditPosts ?? {};
  let added = 0;
  for (const p of batch.posts) {
    if (hist.scannedRedditPosts[p.id]) continue;
    hist.scannedRedditPosts[p.id] = { title: p.title, subreddit: 'r/Beyblade', scannedDate: today() };
    added++;
  }
  writeFileSync(HIST, JSON.stringify(hist, null, 2));
  console.log(`Marcati ${added} post come scansionati (blocco di ${batch.posts.length}).`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'next') {
  const i = rest.indexOf('--size');
  const size = i >= 0 ? parseInt(rest[i + 1], 10) || 60 : 60;
  cmdNext(size);
} else if (cmd === 'done') {
  cmdDone();
} else {
  console.error('Uso: reddit-batch.ts next [--size N] | done');
  process.exit(1);
}
