/**
 * youtube-judge-batch.ts — Serve il giudizio di rilevanza YouTube a blocchi, idempotente.
 *
 * I 745+ video in `data/youtube-cache.json` eccedono un singolo Read: questo script serve all'IA
 * (/judge-youtube) un blocco di video che hanno passato il pre-filtro deterministico
 * (`prefilter === 'pass'`) e NON sono ancora stati giudicati (`relevant === undefined`), in
 * `tmp/youtube-judge-batch.json` (piccolo, 1 Read). Dopo che l'IA decide relevant/lang, `done` fonde
 * il verdetto (`tmp/youtube-judge-extracted.json`) nella cache. Un loop esterno chiama `next`/`done`
 * finché "Rimanenti" = 0.
 *
 * A differenza di reddit-batch.ts (che marca lo stato in scan-history), qui lo stato `relevant` vive
 * NELLA cache, perché la cache È la worklist letta da fetch-transcripts.py.
 *
 * Uso:
 *   npx tsx scripts/youtube-judge-batch.ts next [--size 50]   → scrive il prossimo blocco
 *   npx tsx scripts/youtube-judge-batch.ts done               → fonde i verdetti IA nella cache
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'youtube-cache.json');
const BATCH = join(ROOT, 'tmp', 'youtube-judge-batch.json');
const EXTRACTED = join(ROOT, 'tmp', 'youtube-judge-extracted.json');

const readJson = (p: string, fb: any) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : fb);

interface VideoEntry {
  videoId: string;
  title: string;
  description: string;
  channel: string;
  tags?: string[];
  sourceLang?: string;
  defaultAudioLanguage?: string | null;
  prefilter?: 'pass' | 'drop';
  relevant?: boolean;
  relevanceReason?: string;
  lang?: string;
}

/** Video da giudicare: hanno passato il pre-filtro e non hanno ancora un verdetto IA. */
function isPending(v: VideoEntry): boolean {
  return v.prefilter === 'pass' && v.relevant === undefined;
}

function cmdNext(size: number) {
  const cache = readJson(CACHE, { videos: [] });
  const videos: VideoEntry[] = cache.videos ?? [];
  const pending = videos.filter(isPending);
  const batch = pending.slice(0, size).map((v) => ({
    videoId: v.videoId,
    title: v.title,
    description: (v.description ?? '').slice(0, 1200), // basta il preview per giudicare
    channel: v.channel,
    tags: v.tags ?? [],
    sourceLang: v.sourceLang ?? '',
    defaultAudioLanguage: v.defaultAudioLanguage ?? null,
  }));
  mkdirSync(dirname(BATCH), { recursive: true });
  writeFileSync(BATCH, JSON.stringify({ servedAt: new Date().toISOString().slice(0, 10), videos: batch }, null, 2));
  const droppedPrefilter = videos.filter((v) => v.prefilter === 'drop').length;
  console.log(`Blocco servito: ${batch.length} video in ${BATCH}`);
  console.log(`Rimanenti da giudicare: ${pending.length - batch.length} (cache: ${videos.length} video, ${droppedPrefilter} già scartati dal pre-filtro)`);
}

function cmdDone() {
  const extracted = readJson(EXTRACTED, null);
  if (!extracted || !Array.isArray(extracted.videos ?? extracted)) {
    console.log(`Nessun verdetto in ${EXTRACTED}. Atteso { videos: [{ videoId, relevant, lang, reason }] } o un array.`);
    return;
  }
  const verdicts: any[] = extracted.videos ?? extracted;
  const cache = readJson(CACHE, { videos: [] });
  const byId = new Map<string, VideoEntry>((cache.videos ?? []).map((v: VideoEntry) => [v.videoId, v]));
  let applied = 0;
  let missing = 0;
  for (const j of verdicts) {
    const v = byId.get(j.videoId);
    if (!v) {
      missing++;
      continue;
    }
    v.relevant = !!j.relevant;
    v.relevanceReason = j.reason ?? j.relevanceReason ?? '';
    if (j.lang) v.lang = j.lang;
    applied++;
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  const stillPending = (cache.videos ?? []).filter(isPending).length;
  console.log(`Verdetti applicati: ${applied}${missing ? ` (${missing} videoId non in cache, ignorati)` : ''}.`);
  console.log(`Rimanenti da giudicare: ${stillPending}.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'next') {
  const i = rest.indexOf('--size');
  const size = i >= 0 ? parseInt(rest[i + 1], 10) || 50 : 50;
  cmdNext(size);
} else if (cmd === 'done') {
  cmdDone();
} else {
  console.error('Uso: youtube-judge-batch.ts next [--size N] | done');
  process.exit(1);
}
