import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

const scripts = [
  { name: 'Reddit scraper', cmd: 'npx tsx scripts/scrape-reddit.ts' },
  { name: 'YouTube fetcher', cmd: 'npx tsx scripts/fetch-youtube.ts' },
  { name: 'Sheets fetcher', cmd: 'npx tsx scripts/fetch-sheets.ts' },
  { name: 'Transcript fetcher', cmd: 'python scripts/fetch-transcripts.py' },
];

console.log('Collecting data from all sources');
console.log('================================\n');

let failures = 0;

for (const script of scripts) {
  console.log(`--- ${script.name} ---\n`);
  try {
    execSync(script.cmd, { cwd: ROOT, stdio: 'inherit', timeout: 120_000 });
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
