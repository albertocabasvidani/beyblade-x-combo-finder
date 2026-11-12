/**
 * youtube-mine-batch.ts — Serve i transcript YouTube all'estrazione combo, un blocco alla volta.
 *
 * `data/youtube-transcripts.json` pesa decine di MB: nessun Read lo apre, e /update-combos non lo
 * leggeva affatto. In più `scan-history.scannedVideos` non dice quali video sono stati letti:
 * fetch-youtube.ts ci scrive ogni video nel momento in cui lo scopre, quindi tutti risultano «già
 * scansionati» prima che esista il transcript. Lo stato dell'estrazione vive perciò in un file suo,
 * `data/youtube-mined.json`, scritto solo da questo script.
 *
 * Confine IA / codice: l'IA (/mine-youtube) legge il blocco e dice, per ogni video, quali combo
 * vengono mostrate o raccomandate, già risolte a id del registro. Il codice fa il resto: sceglie i
 * video, controlla che la risposta copra proprio il blocco servito, costruisce l'evidenza (url,
 * data, lingua e canale li prende dalla cache, non dal modello), la fonde in combos.json con lo
 * stesso merge di Reddit e marca i video come letti.
 *
 * YouTube produce solo `mentions` (tier narrative), mai `placements`: un video di torneo racconta
 * un evento che WBO e MetaBeys possono già avere, e senza un id-evento comune sarebbe un doppione.
 *
 * Uso:
 *   npx tsx scripts/youtube-mine-batch.ts next [--chars 120000]  → scrive il blocco e il dizionario parti
 *   npx tsx scripts/youtube-mine-batch.ts done                   → valida, fonde, marca i video letti
 *   npx tsx scripts/youtube-mine-batch.ts count                  → stampa quanti video restano
 *   npx tsx scripts/youtube-mine-batch.ts stats                  → per canale: video letti, con combo, combo trovate
 */
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { cutoffISO } from './lib/freshness';
import { mergeExtracted, type MergeFonte } from './reddit-merge';
import { scriviDizionario, chiaveCombo, voceDaFondere, readJson, today } from './lib/mine-comune';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'youtube-cache.json');
const TRANSCRIPTS = join(ROOT, 'data', 'youtube-transcripts.json');
const MINED = join(ROOT, 'data', 'youtube-mined.json');
const BATCH = join(ROOT, 'tmp', 'youtube-mining-batch.json');
const DICT = join(ROOT, 'tmp', 'youtube-mining-parts.json');
const EXTRACTED = join(ROOT, 'tmp', 'youtube-extracted.json');

const FONTE_YOUTUBE: MergeFonte = {
  source: 'youtube',
  sourceName: 'YouTube',
  sourceUrl: 'https://www.youtube.com',
  notes: 'Combo mostrata o raccomandata in un video YouTube.',
};

const videoUrl = (id: string) => `https://youtube.com/watch?v=${id}`;

interface Pending {
  videoId: string;
  title: string;
  channel: string;
  sourceId: string;
  lang: string;
  date: string;
  description: string;
  transcript: string;
}

/** Video rilevanti, col transcript già scaricato, entro il cutoff e non ancora letti. Dal più recente. */
function pending(): Pending[] {
  const cache = readJson(CACHE, { videos: [] });
  const tr = readJson(TRANSCRIPTS, { transcripts: [] });
  const mined = readJson(MINED, { videos: {} }).videos ?? {};
  const byId = new Map<string, any>((tr.transcripts ?? []).map((t: any) => [t.videoId, t]));
  const limite = cutoffISO();
  const out: Pending[] = [];
  for (const v of cache.videos ?? []) {
    if (v.relevant !== true || mined[v.videoId]) continue;
    const t = byId.get(v.videoId);
    if (!t || !t.transcript) continue;
    const date = String(v.publishedAt ?? '').slice(0, 10);
    if (!date || date < limite) continue;
    out.push({
      videoId: v.videoId,
      title: v.title ?? '',
      channel: v.channel ?? '',
      sourceId: v.sourceId ?? '',
      lang: v.lang ?? t.sourceLanguage ?? v.sourceLang ?? 'en',
      date,
      description: String(v.description ?? '').slice(0, 1500),
      transcript: t.transcript,
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.videoId.localeCompare(b.videoId)));
  return out;
}

function cmdNext(maxChars: number) {
  const all = pending();
  const batch: Pending[] = [];
  let chars = 0;
  for (const v of all) {
    // Almeno un video per blocco, anche se da solo supera il tetto: altrimenti non verrebbe mai servito.
    if (batch.length && chars + v.transcript.length > maxChars) break;
    batch.push(v);
    chars += v.transcript.length;
  }
  mkdirSync(dirname(BATCH), { recursive: true });
  const batchId = randomBytes(6).toString('hex');
  writeFileSync(BATCH, JSON.stringify({ batchId, servedAt: today(), videos: batch }, null, 2));
  rmSync(EXTRACTED, { force: true });
  scriviDizionario(DICT);
  console.log(`Blocco ${batchId}: ${batch.length} video, ${chars} caratteri di transcript, in ${BATCH}`);
  console.log(`Dizionario parti in ${DICT}`);
  console.log(`Rimanenti dopo questo blocco: ${all.length - batch.length}`);
}

function fallisci(msg: string): never {
  console.error(`youtube-mine done RIFIUTATO: ${msg}`);
  console.error('Niente è stato fuso né marcato. Correggi tmp/youtube-extracted.json e rilancia done.');
  process.exit(1);
}

function cmdDone() {
  const batch = readJson(BATCH, null);
  if (!batch?.videos?.length) {
    console.log('Nessun blocco corrente da chiudere.');
    return;
  }
  const ex = readJson(EXTRACTED, null);
  if (!ex) fallisci(`manca ${EXTRACTED}`);
  if (ex.batchId !== batch.batchId) fallisci(`batchId "${ex.batchId}" diverso dal blocco servito "${batch.batchId}"`);
  if (!Array.isArray(ex.videos)) fallisci('atteso { batchId, videos: [{ videoId, combos: [...] }] }');

  const serviti = new Map<string, Pending>(batch.videos.map((v: Pending) => [v.videoId, v]));
  const risposte = new Map<string, any>();
  for (const r of ex.videos) {
    if (!serviti.has(r?.videoId)) fallisci(`videoId "${r?.videoId}" non fa parte del blocco servito`);
    if (!Array.isArray(r.combos)) fallisci(`video ${r.videoId}: "combos" deve essere un array, anche vuoto`);
    risposte.set(r.videoId, r);
  }
  const mancanti = [...serviti.keys()].filter((id) => !risposte.has(id));
  if (mancanti.length) fallisci(`${mancanti.length} video del blocco senza risposta: ${mancanti.join(', ')}`);

  // L'evidenza la costruisce il codice dai dati della cache: il modello fornisce solo parti e kind.
  const daFondere: any[] = [];
  const perVideo: Record<string, number> = {};
  for (const [id, r] of risposte) {
    const v = serviti.get(id)!;
    const viste = new Set<string>();
    for (const c of r.combos) {
      const chiave = chiaveCombo(c);
      if (viste.has(chiave)) continue;
      viste.add(chiave);
      daFondere.push(voceDaFondere(c, { source: 'youtube', sourceId: v.sourceId, url: videoUrl(id), lang: v.lang, date: v.date }));
    }
    perVideo[id] = viste.size;
  }

  const esito = daFondere.length ? mergeExtracted(daFondere, FONTE_YOUTUBE) : { created: 0, updated: 0, skipped: 0 };

  const mined = readJson(MINED, { videos: {} });
  mined.videos = mined.videos ?? {};
  for (const [id, v] of serviti) {
    mined.videos[id] = { sourceId: v.sourceId, date: v.date, minedDate: today(), combosFound: perVideo[id] ?? 0 };
  }
  mined.lastRun = today();
  writeFileSync(MINED, JSON.stringify(mined, null, 2));
  rmSync(EXTRACTED, { force: true });
  rmSync(BATCH, { force: true });

  const conCombo = Object.values(perVideo).filter((n) => n > 0).length;
  console.log(`Blocco ${batch.batchId} chiuso: ${serviti.size} video letti, ${conCombo} con combo, ${daFondere.length} menzioni proposte.`);
  console.log(`Merge: ${esito.created} combo nuove, ${esito.updated} aggiornate, ${esito.skipped} scartate dal registro.`);
  console.log(`Rimanenti: ${pending().length}`);
}

/** Stampa solo il numero di video da leggere: lo leggono i .bat per saltare o contare lo step. */
function cmdCount() {
  console.log(String(pending().length));
}

/** Per canale: video letti, quanti con almeno una combo, combo trovate. Risponde a «questa fonte rende?». */
function cmdStats() {
  const mined = readJson(MINED, { videos: {} }).videos ?? {};
  const righe: Record<string, { letti: number; conCombo: number; menzioni: number }> = {};
  const riga = (k: string) => (righe[k] ??= { letti: 0, conCombo: 0, menzioni: 0 });
  // Si conta da youtube-mined.json e non dalle mentions di combos.json: score-combos.ts tiene una
  // sola mention per `source` in ogni combo, quindi lì il canale delle altre si perde.
  for (const m of Object.values<any>(mined)) {
    const r = riga(m.sourceId || '(senza canale)');
    r.letti++;
    if (m.combosFound > 0) r.conCombo++;
    r.menzioni += m.combosFound ?? 0;
  }
  const attesi = (readJson(join(ROOT, 'data', 'sources.json'), { sources: [] }).sources ?? [])
    .filter((s: any) => s.type === 'youtube')
    .map((s: any) => s.id);
  for (const id of attesi) riga(id);
  console.log('canale'.padEnd(42) + 'letti  con combo     combo');
  for (const [k, r] of Object.entries(righe).sort((a, b) => b[1].menzioni - a[1].menzioni || a[0].localeCompare(b[0]))) {
    console.log(k.padEnd(42) + String(r.letti).padStart(5) + String(r.conCombo).padStart(11) + String(r.menzioni).padStart(10));
  }
  console.log(`Da leggere: ${pending().length}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'next') {
  const i = rest.indexOf('--chars');
  const maxChars = i >= 0 ? parseInt(rest[i + 1], 10) || 120_000 : 120_000;
  cmdNext(maxChars);
} else if (cmd === 'done') {
  cmdDone();
} else if (cmd === 'count') {
  cmdCount();
} else if (cmd === 'letti') {
  // Quanti video risultano letti: i .bat lo confrontano prima e dopo lo step per sapere se ha lavorato.
  console.log(String(Object.keys(readJson(MINED, { videos: {} }).videos ?? {}).length));
} else if (cmd === 'stats') {
  cmdStats();
} else {
  console.error('Uso: youtube-mine-batch.ts next [--chars N] | done | count | letti | stats');
  process.exit(1);
}
