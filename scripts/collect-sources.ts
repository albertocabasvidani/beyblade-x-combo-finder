import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// I fetcher Playwright (MetaBeys/WBO) sono più lenti → timeout dedicato.
const scripts = [
  { name: 'Reddit scraper', cmd: 'npx tsx scripts/scrape-reddit.ts', timeout: 120_000 },
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
