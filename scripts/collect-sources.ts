import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// I fetcher Playwright (MetaBeys/WBO) sono più lenti → timeout dedicato.
const scripts = [
  { name: 'Reddit scraper', cmd: 'npx tsx scripts/scrape-reddit.ts', timeout: 120_000 },
  { name: 'YouTube fetcher', cmd: 'npx tsx scripts/fetch-youtube.ts', timeout: 120_000 },
  { name: 'Sheets fetcher', cmd: 'npx tsx scripts/fetch-sheets.ts', timeout: 120_000 },
  { name: 'MetaBeys fetcher', cmd: 'npx tsx scripts/fetch-metabeys.ts', timeout: 300_000 },
  { name: 'WBO fetcher', cmd: 'npx tsx scripts/fetch-wbo.ts', timeout: 180_000 },
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
