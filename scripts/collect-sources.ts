import { spawn } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// I fetcher Playwright (MetaBeys/WBO) sono più lenti → timeout dedicato.
// `summary` è la regex della riga finale che ogni fetcher stampa con i conteggi: viene ristampata in
// coda al run, così il log della raccolta dice cosa è entrato per fonte e non solo chi è uscito 0
// (dal 06/08 al 26/09/2026 WBO usciva 0 in 38 run su 52 senza scaricare nulla: «Done. 8/8» ogni giorno).
const scripts = [
  // Reddit passa da Bright Data in due tempi (scrape-reddit.ts): ritira la richiesta della notte
  // prima e ne lancia una nuova. Sono poche chiamate HTTP, nessun browser e nessuna attesa lunga.
  { name: 'Reddit scraper', cmd: 'npx tsx scripts/scrape-reddit.ts', timeout: 180_000, summary: /^(Reddit: .*|scrape-reddit fallito.*)$/im },
  { name: 'arca.live scraper (KR)', cmd: 'npx tsx scripts/scrape-arca.ts', timeout: 180_000, summary: /^Salvati \d+ post.*$/im },
  { name: 'YouTube fetcher', cmd: 'npx tsx scripts/fetch-youtube.ts', timeout: 120_000, summary: /^(Saved \d+ new videos.*|Nessun canale letto.*)$/im },
  { name: 'Sheets fetcher', cmd: 'npx tsx scripts/fetch-sheets.ts', timeout: 120_000, summary: /^(Saved to .*|fetch-sheets fallito.*)$/im },
  // Paginazione storica (capped a META_MAX_PAGES/WBO_MAX_PAGES per run): timeout più ampi. Il backfill
  // profondo (META_MAX_PAGES/WBO_MAX_PAGES alti) è un run dedicato one-off, NON questa raccolta giornaliera.
  { name: 'MetaBeys fetcher', cmd: 'npx tsx scripts/fetch-metabeys.ts', timeout: 360_000, summary: /^MetaBeys: (\d+ nuovi eventi.*|pagina 1 non leggibile.*)$/im },
  { name: 'WBO fetcher', cmd: 'npx tsx scripts/fetch-wbo.ts', timeout: 300_000, summary: /^WBO \S+: (ultima pagina = \d+\.|.*intatti\.)$/im },
  // Fonti web con combo complete (sources.json, campo `mine`): richieste HTTP semplici, niente browser.
  // Esce 1 solo se una pagina non ha una lettura buona da più di 3 giorni.
  { name: 'Web fetcher', cmd: 'npx tsx scripts/fetch-web.ts', timeout: 300_000, summary: /^Web: \d+ pagine lette.*$/im },
  // BBX Weekly: cross-check usage per-parte (NON alimenta il CAS). fetch + parse deterministico.
  { name: 'BBX Weekly fetcher', cmd: 'npx tsx scripts/fetch-bbx-weekly.ts', timeout: 120_000, summary: /^Salvate \d+ pagine.*$/im },
  { name: 'BBX Weekly parser', cmd: 'npx tsx scripts/parse-bbx-weekly.ts', timeout: 60_000, summary: /^bbx-weekly: \d+ parti.*$/im },
  // NB: i transcript YouTube girano separati (fetch-transcripts.bat ogni 5 min, --batch 1)
  // per rispettare il rate-limit di YouTube — non vanno inclusi qui.
];

/**
 * Esegue un fetcher con l'output in diretta sul nostro stdout (come `stdio: 'inherit'`) e in copia in
 * memoria, per ripescare la riga di riepilogo. Timeout come prima: il figlio diretto viene ucciso.
 */
function run(cmd: string, timeout: number): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: ROOT, shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const tee = (chunk: Buffer, stream: NodeJS.WriteStream) => { const s = chunk.toString(); out += s; stream.write(s); };
    child.stdout.on('data', (c: Buffer) => tee(c, process.stdout));
    child.stderr.on('data', (c: Buffer) => tee(c, process.stderr));
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, out, timedOut }); });
  });
}

async function main() {
  console.log('Collecting data from all sources');
  console.log('================================\n');

  let failures = 0;
  const report: string[] = [];

  for (const script of scripts) {
    console.log(`--- ${script.name} ---\n`);
    const { code, out, timedOut } = await run(script.cmd, script.timeout);
    const summary = script.summary ? out.match(script.summary)?.[0]?.trim() : undefined;
    if (code === 0) {
      console.log(`\n✓ ${script.name} completed\n`);
      report.push(`  ok   ${script.name}: ${summary ?? '(nessuna riga di riepilogo)'}`);
    } else {
      failures++;
      const why = timedOut ? `timeout dopo ${script.timeout / 1000}s` : `exit ${code}`;
      console.error(`\n✗ ${script.name} failed: ${why}\n`);
      report.push(`  KO   ${script.name}: ${why}${summary ? ` — ${summary}` : ''}`);
    }
  }

  console.log('================================');
  console.log('Per fonte:');
  for (const r of report) console.log(r);
  console.log(`Done. ${scripts.length - failures}/${scripts.length} succeeded.`);

  if (failures > 0) {
    process.exit(1);
  }
}

main();
