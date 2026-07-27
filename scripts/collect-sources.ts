import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// I fetcher Playwright (MetaBeys/WBO) sono più lenti → timeout dedicato.
const scripts = [
  // Reddit: 15 min, non 2. Il ciclo commenti fa `await sleep(2000)` per post (rate-limit voluto):
  // con KEEP_TOP=150 post da arricchire sono ~3s l'uno, cioè ~7,5 min — il vecchio timeout di
  // 120_000 era matematicamente insufficiente sopra i ~40 post e falliva SEMPRE. Il fallimento era
  // mascherato: execSync uccide solo il figlio diretto (cmd.exe), non i nipoti, così lo scraper
  // orfano proseguiva e scriveva la cache minuti dopo che collect l'aveva dato per morto
  // (22/07/2026: "Salvati 150 post" comparso DOPO "Done. 6/8 succeeded"). Sotto carico l'orfano non
  // ce la faceva e la cache non veniva scritta affatto.
  { name: 'Reddit scraper', cmd: 'npx tsx scripts/scrape-reddit.ts', timeout: 900_000 },
  { name: 'arca.live scraper (KR)', cmd: 'npx tsx scripts/scrape-arca.ts', timeout: 180_000 },
  { name: 'YouTube fetcher', cmd: 'npx tsx scripts/fetch-youtube.ts', timeout: 120_000 },
  { name: 'Sheets fetcher', cmd: 'npx tsx scripts/fetch-sheets.ts', timeout: 120_000 },
  // Paginazione storica (capped a META_MAX_PAGES/WBO_MAX_PAGES per run): timeout più ampi. Il backfill
  // profondo (META_MAX_PAGES/WBO_MAX_PAGES alti) è un run dedicato one-off, NON questa raccolta giornaliera.
  { name: 'MetaBeys fetcher', cmd: 'npx tsx scripts/fetch-metabeys.ts', timeout: 360_000 },
  { name: 'WBO fetcher', cmd: 'npx tsx scripts/fetch-wbo.ts', timeout: 300_000 },
  // BBX Weekly: cross-check usage per-parte (NON alimenta il CAS). fetch + parse deterministico.
  { name: 'BBX Weekly fetcher', cmd: 'npx tsx scripts/fetch-bbx-weekly.ts', timeout: 120_000 },
  { name: 'BBX Weekly parser', cmd: 'npx tsx scripts/parse-bbx-weekly.ts', timeout: 60_000 },
  // NB: i transcript YouTube girano separati (fetch-transcripts.bat ogni 5 min, --batch 1)
  // per rispettare il rate-limit di YouTube — non vanno inclusi qui.
];

console.log('Collecting data from all sources');
console.log('================================\n');

let failures = 0;

for (const script of scripts) {
  console.log(`--- ${script.name} ---\n`);
  try {
    execSync(script.cmd, { cwd: ROOT, stdio: 'inherit', timeout: script.timeout });
    console.log(`\n✓ ${script.name} completed\n`);
  } catch (err) {
    failures++;
    console.error(`\n✗ ${script.name} failed: ${(err as Error).message}\n`);
  }
}

console.log('================================');
console.log(`Done. ${scripts.length - failures}/${scripts.length} succeeded.`);

if (failures > 0) {
  process.exit(1);
}
