/**
 * e2e-smoke.ts — percorre il sito come un utente (Chrome di sistema via playwright-core, headless)
 * e verifica peso della pagina, dataset separato, ricerca parti, filtro periodo, filtri, paginazione,
 * link Amazon, marketplace, tema, pagine secondarie, mobile, e le pagine editoriali (meta/parts/
 * combos/buy: sitemap vs dist/, H1 unico, canonical, JSON-LD, disclosure, tag= su ogni link Amazon).
 * Stampa OK/KO per passo ed esce 1 se un passo fallisce. Screenshot in tmp/e2e/.
 *
 * Precondizione: `npm run build && npm run preview` in un altro terminale (porta 4321).
 * Esegui: npm run test:e2e            (E2E_URL per un'altra origine, es. https://beybladexcombos.com)
 */
import { chromium, type Page, type Browser, type BrowserContext, type Response } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const BASE = (process.env.E2E_URL ?? 'http://localhost:4321').replace(/\/$/, '');
const SHOTS = join(ROOT, 'tmp', 'e2e');
const HOME_MAX_BYTES = 400_000;
const PAGE_SIZE = 60;        // card per pagina (PAGE in combo-search.tsx)
const INLINE = 30;           // combo inline nella home (INITIAL_COMBOS in slim-combos.ts)

let pass = 0, fail = 0, skip = 0;
function check(name: string, cond: boolean, extra = ''): boolean {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  KO   ${name}${extra ? ' — ' + extra : ''}`); }
  return cond;
}
function skipped(name: string, why: string) { skip++; console.log(`  SKIP ${name} — ${why}`); }

/** Chiave PostHog configurata nel sorgente: placeholder → nessuna richiesta attesa, chiave vera → almeno una. */
function posthogConfigured(): boolean {
  const env = process.env.PUBLIC_POSTHOG_KEY;   // stessa variabile letta dalla build (import.meta.env)
  if (env) return !env.startsWith('phc_INCOLLA');
  const p = join(ROOT, 'src', 'lib', 'analytics-config.ts');
  if (!existsSync(p)) return false;
  const m = readFileSync(p, 'utf8').match(/POSTHOG_KEY[^\n]*?'(phc_[^']*)'/);
  return !!m && !m[1].startsWith('phc_INCOLLA');
}

interface Net { home?: Response; responses: Response[]; requests: string[] }
function watch(page: Page): Net {
  const net: Net = { responses: [], requests: [] };
  page.on('request', (r) => net.requests.push(r.url()));
  page.on('response', (r) => { net.responses.push(r); if (r.url().replace(/\/$/, '') === BASE && r.request().resourceType() === 'document') net.home = r; });
  return net;
}
function consoleErrors(page: Page): string[] {
  const errs: string[] = [];
  // Con una chiave PostHog di prova (phc_test…) il server risponde 404: non è un errore del sito.
  const testKey = (process.env.PUBLIC_POSTHOG_KEY ?? '').startsWith('phc_test');
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (testKey && /posthog/i.test(m.location()?.url ?? '')) return;
    errs.push(`${m.text()} [${m.location()?.url ?? ''}]`);
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

const num = (s: string | null) => parseInt((s ?? '').replace(/[^\d]/g, ''), 10);
const resultsCount = async (page: Page) => num(await page.getByTestId('results-count').textContent());
const visibleCards = (page: Page) => page.locator('[data-testid=combo-card]:visible');
const firstCardId = async (page: Page) => visibleCards(page).first().getAttribute('data-combo-id');
const bladeRows = (page: Page) => page.locator('[data-testid=blade-row]:visible');
/** Valore della metrica (`topCut` | `wins`) su ogni card o riga visibile; 0 dove il valore non è mostrato. */
const metricValues = (page: Page, sel: string, metric: string) => page.locator(sel).evaluateAll(
  (els, m) => els.map((el) => { const v = el.querySelector(`[data-metric="${m}"]`); return v ? parseInt((v.textContent ?? '').replace(/[^\d]/g, ''), 10) : 0; }),
  metric,
);
const nonIncreasing = (a: number[]) => a.every((v, i) => i === 0 || v <= a[i - 1]);
/** Quote % lette dalle righe lama (testo «19.6% of top cuts»). */
const shareValues = (page: Page) => bladeRows(page).evaluateAll((els) => els.map((el) => {
  const m = (el.textContent ?? '').match(/(\d+(?:\.\d+)?)%/); return m ? parseFloat(m[1]) : 0;
}));

async function addPart(page: Page, query: string) {
  const input = page.locator('input[type=text]').first();
  await input.click();
  await input.fill(query);
  // L'opzione col nome esatto, non la prima: «1-60» trova anche lame il cui nome occidentale contiene
  // il ratchet («Rock Golem 1-60UN»), e la prima opzione era quella lama.
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = page.locator('ul li button').filter({ has: page.locator('span.truncate', { hasText: new RegExp(`^${esc}$`) }) });
  await ((await exact.count()) > 0 ? exact.first() : page.locator('ul li button').first()).click();
}

async function waitDataset(page: Page) {
  // Le combo inline sono INLINE: il contatore supera quel numero solo dopo il fetch di /combos.json.
  await page.waitForFunction((n) => {
    const el = document.querySelector('[data-testid=results-count]');
    return !!el && parseInt((el.textContent ?? '').replace(/[^\d]/g, ''), 10) > n;
  }, INLINE, { timeout: 15_000 });
}

async function desktopFlow(context: BrowserContext) {
  const page = await context.newPage();
  const net = watch(page);
  const errs = consoleErrors(page);
  console.log('\n[1] Home');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const homeBytes = net.home ? (await net.home.body()).length : -1;
  check(`home HTTP 200`, net.home?.status() === 200, `status=${net.home?.status()}`);
  check(`home sotto ${HOME_MAX_BYTES.toLocaleString('it-IT')} byte`, homeBytes > 0 && homeBytes < HOME_MAX_BYTES, `${homeBytes.toLocaleString('it-IT')} byte`);
  const combosJson = net.responses.find((r) => r.url().endsWith('/combos.json'));
  check('fetch /combos.json 200', combosJson?.status() === 200, `status=${combosJson?.status()}`);
  const ph = net.requests.filter((u) => /posthog/i.test(u)).length;
  if (posthogConfigured()) check('PostHog contattato (chiave vera configurata)', ph > 0, `richieste=${ph}`);
  else check('nessuna richiesta PostHog (chiave non configurata)', ph === 0, `richieste=${ph}`);
  check('nessun errore in console', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('[2] Cookie e storage');
  const cookies = await context.cookies();
  // Gli unici cookie ammessi sono quelli della CMP di Google (FCCDCF/FCNEC: la scelta sul consenso
  // pubblicitario, scritta solo sul dominio registrato in AdSense). Il sito non ne scrive di suoi e
  // PostHog resta cookieless.
  const cookieNostri = cookies.filter((c) => !/^(FCCDCF|FCNEC)$/.test(c.name));
  check('nessun cookie oltre a quelli della CMP', cookieNostri.length === 0, cookies.map((c) => c.name).join(','));
  const lsKeys: string[] = await page.evaluate(() => Object.keys(localStorage));
  // `google_*` lo scrive la CMP di Google (messaggio di consenso AdSense): e' lo stato del consenso,
  // non tracciamento nostro. PostHog resta cookieless e non deve comparire (`ph_*`).
  check('localStorage solo preferenze e consenso (niente ph_*)',
    lsKeys.every((k) => ['theme', 'bxcf-marketplace'].includes(k) || k.startsWith('google_')), lsKeys.join(','));

  console.log('[3] Dataset completo');
  await waitDataset(page);
  const total = await resultsCount(page);
  check(`contatore risultati > ${INLINE} dopo il fetch`, total > INLINE, `=${total}`);
  check(`card visibili = ${PAGE_SIZE} (paginazione)`, (await visibleCards(page).count()) === PAGE_SIZE, `=${await visibleCards(page).count()}`);
  check('stato del dataset: ready', (await page.getByTestId('period-hint').getAttribute('data-dataset')) === 'ready');
  check('dopo il fetch nessun controllo disabilitato', (await page.locator('[aria-disabled=true]').count()) === 0);

  console.log('[4] Cerca e aggiunge una parte');
  await addPart(page, 'Wizard Rod');
  check('chip "remove Wizard Rod" presente', (await page.locator('button[aria-label="remove Wizard Rod"]').count()) === 1);
  check('titolo ranking in modalita solo-blade', (await page.locator('h2').filter({ hasText: 'Wizard Rod' }).count()) > 0);
  const bladeCount = await resultsCount(page);
  check('contatore sceso', bladeCount > 0 && bladeCount < total, `${total} -> ${bladeCount}`);

  console.log('[5] Periodo (30/90/180/365 giorni)');
  const first365 = await firstCardId(page);
  const count365 = await resultsCount(page);
  await page.getByTestId('period-30').click();
  const count30 = await resultsCount(page);
  check('30D: contatore <= 1Y', count30 <= count365, `${count30} vs ${count365}`);
  check('30D: hint del periodo aggiornato', /last 30 days/i.test((await page.getByTestId('period-hint').textContent()) ?? ''));
  const badges = await page.locator('[data-testid=score-badge]:visible').allTextContents();
  check('30D: ogni badge ha un numero', badges.length === Math.min(count30, PAGE_SIZE) && badges.every((b) => /^\d+\.\d/.test(b.trim())), `${badges.length} badge`);
  await page.getByTestId('period-90').click();
  const count90 = await resultsCount(page);
  await page.getByTestId('period-180').click();
  const count180 = await resultsCount(page);
  check('contatori crescenti 30D <= 90D <= 180D <= 1Y', count30 <= count90 && count90 <= count180 && count180 <= count365, `${count30} ${count90} ${count180} ${count365}`);
  await page.getByTestId('period-365').click();
  check('1Y: stessa prima card di prima', (await firstCardId(page)) === first365, `${first365} vs ${await firstCardId(page)}`);
  check('1Y: stesso contatore di prima', (await resultsCount(page)) === count365);

  console.log('[6] Filtri');
  const before = await resultsCount(page);
  await page.getByRole('button', { name: 'Tournament-proven' }).click();
  const tp = await resultsCount(page);
  check('Tournament-proven non aumenta i risultati', tp <= before, `${before} -> ${tp}`);
  await page.getByRole('button', { name: 'Meta / top-tier' }).click();
  check('Meta only non aumenta i risultati', (await resultsCount(page)) <= tp);
  await page.getByRole('button', { name: 'Meta / top-tier' }).click();
  await page.getByRole('button', { name: 'Tournament-proven' }).click();
  check('filtri tolti: contatore ripristinato', (await resultsCount(page)) === before);

  console.log('[7] Show more');
  await page.locator('button[aria-label="remove Wizard Rod"]').click();
  check('ranking completo ripristinato', (await resultsCount(page)) === total);
  check(`card visibili ${PAGE_SIZE}`, (await visibleCards(page).count()) === PAGE_SIZE);
  await page.getByTestId('load-more').click();
  check(`card visibili ${PAGE_SIZE * 2} dopo Show more`, (await visibleCards(page).count()) === PAGE_SIZE * 2, `=${await visibleCards(page).count()}`);

  console.log('[7b] Buy parts senza selezione');
  // Superficie affiliata per chi guarda solo il ranking: il pannello si apre dalla card, senza Compare.
  const toggles = page.locator('[data-testid=combo-card]:visible [data-testid=buy-parts-toggle]');
  check('ogni card ha il pulsante Buy parts', (await toggles.count()) === await visibleCards(page).count(), `${await toggles.count()} pulsanti`);
  check('nessun pannello aperto di default', (await page.locator('[data-testid=buy-parts-panel]').count()) === 0);
  await toggles.first().click();
  const panel = page.locator('[data-testid=combo-card]:visible [data-testid=buy-parts-panel]').first();
  check('pannello aperto dopo il click', (await panel.count()) === 1);
  const partLinks = panel.locator('a[data-testid=buy-part]');
  const nParts = await partLinks.count();
  check('almeno 3 parti linkate (BX) o 5 (CX)', nParts >= 3, `=${nParts}`);
  const panelHrefs = await partLinks.evaluateAll((as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, rel: a.getAttribute('rel') ?? '', target: a.getAttribute('target') })));
  check('link del pannello verso amazon, sponsored, _blank',
    panelHrefs.every((h) => /^https:\/\/www\.amazon\./.test(h.href) && /sponsored/.test(h.rel) && h.target === '_blank'), panelHrefs[0]?.href);
  const panelMarket = await page.getByTestId('marketplace').inputValue();
  check(`link del pannello con tracking ID (mercato ${panelMarket})`, panelHrefs.every((h) => /[?&]tag=/.test(h.href)), panelHrefs[0]?.href);
  // Ogni parte anche su tutti i negozi, ciascuno col suo tag: è la via dalla home ad amazon.fr per chi
  // non è in Francia, come un revisore Associates (rifiuto FR del 21/09/2026).
  const amazonCfg = JSON.parse(readFileSync(join(ROOT, 'data', 'amazon-config.json'), 'utf8'));
  const storeRows = panel.locator('[data-testid=buy-parts-stores] > div');
  const rowsHrefs: string[][] = await storeRows.evaluateAll((rows) =>
    rows.map((r) => [...r.querySelectorAll('a')].map((a) => (a as HTMLAnchorElement).href)));
  check('pannello: una riga di negozi per ogni parte linkata', rowsHrefs.length === nParts, `${rowsHrefs.length} righe, ${nParts} parti`);
  const rigaCompleta = (hrefs: string[]) => Object.values(amazonCfg.marketplaces).every((m: any) =>
    hrefs.some((h) => h.startsWith(`https://www.${m.tld}/`) && h.includes(`tag=${m.tag}`)));
  check('pannello: ogni riga ha tutti i negozi col proprio tag', rowsHrefs.length > 0 && rowsHrefs.every(rigaCompleta), rowsHrefs[0]?.join(' ') ?? '');
  await toggles.first().click();
  check('pannello richiuso', (await page.locator('[data-testid=buy-parts-panel]').count()) === 0);

  console.log('[8] Ricerca come filtro + Buy');
  // Le parti cercate filtrano sempre: lama Wizard Rod E bit Hexa. Niente più «Compare» né «Buildable».
  check('nessun interruttore Compare né pulsante Buildable', (await page.locator('button[role=switch]').count()) === 0
    && (await page.getByRole('button', { name: 'Buildable' }).count()) === 0);
  await addPart(page, 'Wizard Rod');
  await addPart(page, 'Hexa');
  const wrHexa = await page.locator('[data-testid=combo-card]:visible').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-blade')}|${e.querySelector('h3')?.textContent ?? ''}`));
  check('Wizard Rod + Hexa: solo combo con quella lama e quel bit', wrHexa.length > 0 && wrHexa.every((x) => x.startsWith('wizard-rod|') && /hexa$/i.test(x.trim())), wrHexa.slice(0, 4).join(', '));
  await addPart(page, 'Shark Scale');
  const twoBlades = await page.locator('[data-testid=combo-card]:visible').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-blade')))]);
  check('due lame nella stessa categoria valgono «o»: Wizard Rod o Shark Scale, sempre con Hexa', twoBlades.every((b) => b === 'wizard-rod' || b === 'shark-scale') && twoBlades.includes('shark-scale'), twoBlades.join(','));
  await page.locator('button[aria-label="remove Shark Scale"]').click();
  await page.locator('[data-testid=combo-card]:visible [data-testid=buy-parts-toggle]').first().click();
  const buy = page.locator('[data-testid=combo-card]:visible a[data-testid=buy-part]');
  if ((await buy.count()) === 0) skipped('link Buy', 'nessun link Buy nella pagina (Amazon non ancora attivo)');
  else {
    const hrefs = await buy.evaluateAll((as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })));
    check('ogni Buy punta ad amazon.', hrefs.every((h) => /^https:\/\/www\.amazon\./.test(h.href)), hrefs[0]?.href);
    check('ogni Buy ha target=_blank e rel sponsored', hrefs.every((h) => h.target === '_blank' && /sponsored/.test(h.rel)));
    const market = await page.getByTestId('marketplace').inputValue();
    const tagged = hrefs.filter((h) => /[?&]tag=/.test(h.href)).length;
    // Senza eccezioni, su ogni mercato: un link non tracciato e' la contestazione del 19/09/2026.
    check(`mercato ${market}: tutti i link con tag`, tagged === hrefs.length, `${tagged}/${hrefs.length}`);
    console.log('[9] Marketplace');
    await page.getByTestId('marketplace').selectOption('de');
    const deHrefs: string[] = await buy.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    check('link Buy passano ad amazon.de', deHrefs.every((h) => h.startsWith('https://www.amazon.de/')), deHrefs[0]);
    await page.reload({ waitUntil: 'networkidle' });
    check('marketplace persistito dopo reload', (await page.getByTestId('marketplace').inputValue()) === 'de');
  }

  console.log('[10] Tema');
  // Il toggle sta nell'header, che non e' sticky: dopo i passi precedenti la pagina resta scrollata
  // (toggle a y=-106) e il click cade a vuoto mentre il layout si assesta. Un utente per cliccarlo
  // deve comunque risalire: si scrolla in cima, come farebbe lui.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const theme0 = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator('#theme-toggle').click();
  const theme1 = await page.evaluate(() => document.documentElement.dataset.theme);
  check('toggle cambia data-theme', !!theme1 && theme1 !== theme0, `${theme0} -> ${theme1}`);
  await page.reload({ waitUntil: 'networkidle' });
  check('tema persistito dopo reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === theme1);
  await page.locator('#theme-toggle').click();   // ripristina

  console.log('[11] Pagine');
  const about = await page.goto(BASE + '/about/', { waitUntil: 'networkidle' });
  check('/about/ 200', about?.status() === 200);
  const aboutText = (await page.textContent('body')) ?? '';
  if (/Amazon/i.test(aboutText)) check('about: sezione affiliazione', true); else skipped('about: sezione affiliazione', 'non ancora presente');
  const privacy = await page.goto(BASE + '/privacy/', { waitUntil: 'networkidle' });
  if (!privacy || privacy.status() !== 200) skipped('/privacy/', `status=${privacy?.status()} (pagina non ancora creata)`);
  else check('privacy: sezione analytics', /PostHog/i.test((await page.textContent('body')) ?? ''));
  const guides = await page.goto(BASE + '/guides/', { waitUntil: 'networkidle' });
  check('/guides/ 200', guides?.status() === 200);
  for (const sec of ['parts', 'combos', 'buy']) {
    const n = await page.locator(`[data-testid=guides-${sec}] li a`).count();
    check(`guides: sezione ${sec} con le sue guide e il link all'elenco`, n > 0 && (await page.locator(`[data-testid=guides-${sec}] a[href$="/${sec}/"]`).count()) > 0, `${n} guide`);
  }
  const navDesk = await page.locator('header nav').first().locator('a:visible').allTextContents();
  check('header: Home · Meta · Guides · How scoring works', JSON.stringify(navDesk.slice(1).map((x) => x.trim().toLowerCase())) === JSON.stringify(['home', 'meta', 'guides', 'how scoring works']), navDesk.join(' | '));
  check('header: Guides attiva su /guides/', (await page.locator('header a[aria-current=page]').textContent())?.trim() === 'Guides');
  const partPage = await page.goto(BASE + '/parts/shark-scale/', { waitUntil: 'networkidle' });
  if (partPage?.status() === 200) {
    const crumbs = ((await page.locator('nav[aria-label=Breadcrumb]').textContent()) ?? '').split('/').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    check('breadcrumb di una parte: Home › Guides › Parts › …', crumbs[0]?.startsWith('Home') && crumbs[1]?.startsWith('Guides') && crumbs[2]?.startsWith('Parts'), crumbs.join(' › '));
  } else skipped('breadcrumb di una parte', `/parts/shark-scale/ status ${partPage?.status()}`);
  const oldTopCut = await page.goto(BASE + '/top-cut/');
  check('/top-cut/ non esiste più', oldTopCut?.status() === 404, `status=${oldTopCut?.status()}`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const footer = (await page.locator('footer').textContent()) ?? '';
  if (/Amazon Associate/i.test(footer)) check('footer: disclosure Amazon', true); else skipped('footer: disclosure Amazon', 'non ancora presente');

  console.log('[13] Screenshot desktop');
  await waitDataset(page);
  await page.screenshot({ path: join(SHOTS, 'home-desktop-365d.png'), fullPage: false });
  await page.getByTestId('period-30').click();
  await page.screenshot({ path: join(SHOTS, 'home-desktop-30d.png'), fullPage: false });
  await page.close();
}

/** Tutti gli index.html sotto dist/, ricorsivo — per confrontare il conteggio con la sitemap. */
function countDistPages(): number {
  const dist = join(ROOT, 'dist');
  if (!existsSync(dist)) return -1;
  let n = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (entry === 'index.html') n++;
    }
  };
  walk(dist);
  return n;
}

const EDITORIAL_MAX_BYTES = 150_000;
const JSON_LD_TYPES = new Set(['Article', 'BlogPosting', 'ItemList', 'BreadcrumbList', 'WebSite', 'Organization']);

async function editorialFlow(context: BrowserContext) {
  console.log('\n[14] Editoriale (meta/parts/combos/buy)');

  // La sitemap è la fonte della verità sulle pagine pubblicate: si parte da lì, non da un elenco
  // scritto a mano, così un URL nuovo o sparito si vede da solo.
  let sitemapUrls: string[] = [];
  try {
    const xml = await (await fetch(`${BASE}/sitemap-0.xml`)).text();
    sitemapUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  } catch (e) {
    check('sitemap-0.xml raggiungibile', false, String(e));
    return;
  }
  check(`sitemap ha almeno 15 URL (era 3 prima del piano contenuti)`, sitemapUrls.length >= 15, `=${sitemapUrls.length}`);

  const distPages = countDistPages();
  if (distPages >= 0) {
    check('numero di URL in sitemap = pagine HTML in dist/', sitemapUrls.length === distPages, `sitemap=${sitemapUrls.length} dist=${distPages}`);
  } else {
    skipped('confronto sitemap vs dist/', 'dist/ non trovato (build non ancora fatta in locale)');
  }

  const editorialUrls = sitemapUrls.filter((u) => /\/(meta|parts|combos|buy|guides)\//.test(u));
  check('almeno una pagina per ciascuna delle 4 sezioni editoriali', ['meta', 'parts', 'combos', 'buy'].every((s) => editorialUrls.some((u) => u.includes(`/${s}/`))), editorialUrls.join(', '));

  for (const url of editorialUrls) {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const page = await context.newPage();
    const errs = consoleErrors(page);
    const net = watch(page);
    const resp = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const label = path;

    check(`${label}: 200`, resp?.status() === 200, `status=${resp?.status()}`);
    const html = resp ? await resp.text() : '';
    check(`${label}: sotto ${EDITORIAL_MAX_BYTES.toLocaleString('it-IT')} byte`, html.length > 0 && html.length < EDITORIAL_MAX_BYTES, `${html.length.toLocaleString('it-IT')} byte`);

    const h1Count = await page.locator('h1').count();
    check(`${label}: esattamente un H1`, h1Count === 1, `=${h1Count}`);

    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    const expected = url.endsWith('/') ? url : url + '/';
    check(`${label}: canonical = URL con slash finale`, canonical === expected, `${canonical} vs ${expected}`);

    // Ogni <script type=application/ld+json> deve essere JSON valido con un @type fra quelli noti.
    const ldTexts = await page.locator('script[type="application/ld+json"]').allTextContents();
    check(`${label}: almeno un blocco JSON-LD`, ldTexts.length > 0, `=${ldTexts.length}`);
    const ldOk = ldTexts.every((t) => {
      try { const d = JSON.parse(t); return JSON_LD_TYPES.has(d['@type']); } catch { return false; }
    });
    check(`${label}: ogni JSON-LD è valido con @type noto`, ldOk, ldTexts.map((t) => t.slice(0, 60)).join(' | '));

    // La disclosure deve stare nel contenuto (main), non solo nel footer — solo dove ci sono link Buy.
    // Solo i link dentro main: quelli del footer (un link per negozio) stanno su ogni pagina, hub
    // compresi, e hanno la loro disclosure accanto.
    const amazonLinks = await page.locator('main a[href*="amazon."]').evaluateAll((as) =>
      as.map((a) => ({ href: (a as HTMLAnchorElement).href, rel: a.getAttribute('rel') ?? '', target: a.getAttribute('target') })));
    if (amazonLinks.length > 0) {
      const disclosureInMain = (await page.locator('main [data-testid=amazon-disclosure]').count()) > 0;
      check(`${label}: disclosure dentro il contenuto (${amazonLinks.length} link Amazon)`, disclosureInMain);
      check(`${label}: ogni link Amazon ha tag=`, amazonLinks.every((l) => /[?&]tag=/.test(l.href)), amazonLinks.find((l) => !/[?&]tag=/.test(l.href))?.href ?? '');
      check(`${label}: ogni link Amazon è sponsored/nofollow, target=_blank`,
        amazonLinks.every((l) => /sponsored/.test(l.rel) && /nofollow/.test(l.rel) && l.target === '_blank'));
    } else {
      skipped(`${label}: link Amazon`, 'nessuno su questa pagina (hub o parte senza set noto)');
    }

    // Le pagine editoriali sono statiche: non devono scaricare il dataset intero della home.
    const fetchedCombosJson = net.requests.some((u) => u.endsWith('/combos.json'));
    check(`${label}: non fetcha /combos.json`, !fetchedCombosJson);

    check(`${label}: nessun errore in console`, errs.length === 0, errs.slice(0, 2).join(' | '));

    await page.close();
  }
}

/**
 * [15] Il negozio deve seguire il PAESE del visitatore, non la lingua del browser: è il caso
 * normale di chi arriva da una ricerca, ed è quello che vede un revisore Amazon che apre il sito
 * dal proprio paese con un browser in inglese. Il paese si simula intercettando la richiesta a
 * Cloudflare, così il test non dipende da dove gira.
 */
async function countryFlow(browser: Browser) {
  console.log('\n[15] Negozio dal paese del visitatore');
  const config = JSON.parse(readFileSync(join(ROOT, 'data', 'amazon-config.json'), 'utf8'));
  const tagDi = (m: string) => config.marketplaces[m].tag;

  /** Un contesto che risponde `loc=<paese>` alla sonda geografica; `null` la fa fallire. */
  const contesto = async (paese: string | null) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
    await ctx.route('**/cdn-cgi/trace', (route) =>
      paese ? route.fulfill({ status: 200, contentType: 'text/plain', body: `fl=1\nloc=${paese}\nvisit_scheme=https\n` })
            : route.abort());
    return ctx;
  };
  const risolto = (page: Page) => page.waitForFunction(() => !!(window as any).__bxcfMarket, null, { timeout: 8000 });
  const linkAmazon = (page: Page) => page.locator('a[data-testid=buy-part]')
    .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));

  // --- Visitatore in Francia, browser in inglese: il paese vince sulla lingua.
  const fr = await contesto('FR');
  const page = await fr.newPage();
  await page.goto(BASE + '/buy/BX-48/', { waitUntil: 'networkidle' });
  await risolto(page);
  let hrefs = await linkAmazon(page);
  check('FR: i link vanno su amazon.fr', hrefs.length > 0 && hrefs.every((h) => h.includes('www.amazon.fr/')), hrefs[0] ?? 'nessun link');
  check('FR: ogni link porta il tag francese', hrefs.every((h) => h.includes(`tag=${tagDi('fr')}`)), hrefs[0] ?? '');
  const nota = (await page.getByTestId('market-note').first().textContent()) ?? '';
  check('FR: la nota dice che il paese è stato rilevato', /detected from your location/i.test(nota), nota);
  check('FR: nessun blocco del redirect su una scelta non sua', hrefs.every((h) => !h.includes('creatorsDisableRedirect')), hrefs[0] ?? '');

  // --- Il visitatore corregge a mano (il caso VPN): la sua scelta vince e resta.
  await page.locator('header [data-buy-market]').selectOption('it');
  await page.waitForFunction(() => (window as any).__bxcfMarket?.source === 'user', null, { timeout: 5000 });
  hrefs = await linkAmazon(page);
  check('scelta manuale IT: i link vanno su amazon.it', hrefs.every((h) => h.includes('www.amazon.it/')), hrefs[0] ?? '');
  check('scelta manuale IT: tag italiano', hrefs.every((h) => h.includes(`tag=${tagDi('it')}`)), hrefs[0] ?? '');
  check('scelta manuale: i link impediscono ad Amazon di spostare il visitatore',
    hrefs.every((h) => h.includes('creatorsDisableRedirect=true')), hrefs[0] ?? '');
  const notaScelta = (await page.getByTestId('market-note').first().textContent()) ?? '';
  check('scelta manuale: la nota lo dice', /your choice/i.test(notaScelta), notaScelta);
  await page.close();

  // Stesso profilo, ma adesso il paese rilevato è un altro: la scelta salvata deve reggere.
  await fr.route('**/cdn-cgi/trace', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'loc=DE\n' }));
  const page2 = await fr.newPage();
  await page2.goto(BASE + '/buy/BX-48/', { waitUntil: 'networkidle' });
  await risolto(page2);
  hrefs = await linkAmazon(page2);
  check('dopo un reload con paese DE: la scelta manuale IT resiste', hrefs.every((h) => h.includes('www.amazon.it/')), hrefs[0] ?? '');
  await page2.close();
  await fr.close();

  // --- Sonda irraggiungibile (ad blocker, rete): si scende alla lingua, mai a un link senza tag.
  const muto = await contesto(null);
  const page3 = await muto.newPage();
  await page3.goto(BASE + '/buy/BX-48/', { waitUntil: 'networkidle' });
  await risolto(page3);
  hrefs = await linkAmazon(page3);
  const tagValidi = new Set(Object.values(config.marketplaces).map((m: any) => m.tag));
  check('geo non disponibile: i link restano tutti taggati',
    hrefs.length > 0 && hrefs.every((h) => [...tagValidi].some((t) => h.includes(`tag=${t}`))), hrefs[0] ?? '');
  // I link riscritti dallo script cercano il nome della parte, non il testo del link.
  check('link riscritti: la ricerca non contiene «Buy on Amazon»',
    hrefs.every((h) => !/Buy%20on%20Amazon|%E2%80%94/.test(h)), hrefs.find((h) => /Buy%20on%20Amazon|%E2%80%94/.test(h)) ?? '');
  check('geo non disponibile: browser en-US → negozio di default',
    hrefs.every((h) => h.includes(`www.${config.marketplaces[config.defaultMarketplace].tld}/`)), hrefs[0] ?? '');
  await page3.close();
  await muto.close();

  // --- Home: l'isola Preact e il selettore dell'header devono mostrare lo stesso negozio.
  const de = await contesto('DE');
  const page4 = await de.newPage();
  await page4.goto(BASE + '/', { waitUntil: 'networkidle' });
  await risolto(page4);
  const valori = await page4.locator('[data-buy-market], [data-testid=marketplace]')
    .evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  check('DE: header e pannello della home mostrano lo stesso negozio',
    valori.length >= 2 && new Set(valori).size === 1 && valori[0] === 'de', valori.join(','));
  await page4.close();
  await de.close();
}

/**
 * [16] Casistiche d'uso del ranking: le domande tipiche di chi arriva in home.
 * Lettura dei valori dal DOM (data-metric, data-blade, data-line), mai dai nomi: i dati cambiano ogni notte.
 */
async function rankingFlow(context: BrowserContext) {
  const page = await context.newPage();
  const errs = consoleErrors(page);
  console.log('\n[16] Ranking: casistiche d\u2019uso');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await waitDataset(page);
  const cards = '[data-testid=combo-card]:visible';
  const rows = '[data-testid=blade-row]:visible';

  // 1. «Cosa va forte adesso?» — 30D · Top cuts · Combos
  await page.getByTestId('period-30').click();
  const count30 = await resultsCount(page);
  await page.getByTestId('sort-topCut').click();
  check('1. top cut: stesso contatore dell ordinamento per score', (await resultsCount(page)) === count30);
  const tc = await metricValues(page, cards, 'topCut');
  check('1. top cut: valori non crescenti lungo la lista', tc.length > 0 && nonIncreasing(tc), tc.slice(0, 8).join(','));
  const underlined = await page.locator(`${cards} [data-metric=topCut]`).first().getAttribute('class');
  check('1. top cut: la metrica scelta è sottolineata', /underline/.test(underlined ?? ''), underlined ?? '');
  check('1. hint: «most top cuts … last 30 days»', /most top cuts.*last 30 days/i.test((await page.getByTestId('period-hint').textContent()) ?? ''));

  // 2. «Chi vince di più?» — 30D · Wins
  await page.getByTestId('sort-wins').click();
  const wins = await metricValues(page, cards, 'wins');
  check('2. vittorie: valori non crescenti lungo la lista', wins.length > 0 && nonIncreasing(wins), wins.slice(0, 8).join(','));
  check('2. vittorie: sottolineata la metrica vittorie, non i top cut',
    /underline/.test((await page.locator(`${cards} [data-metric=wins]`).first().getAttribute('class')) ?? '')
    && !/underline/.test((await page.locator(`${cards} [data-metric=topCut]`).first().getAttribute('class')) ?? ''));

  // 3. «Quale lama devo comprare?» — 30D · Top cuts · Blades
  await page.getByTestId('sort-topCut').click();
  await page.getByTestId('view-blades').click();
  const nBlades = await resultsCount(page);
  check('3. vista lame: contatore in lame e righe visibili', /blades/.test((await page.getByTestId('results-count').textContent()) ?? '') && (await bladeRows(page).count()) === Math.min(nBlades, PAGE_SIZE), `${nBlades} lame`);
  check('3. vista lame: nessuna card combo visibile', (await visibleCards(page).count()) === 0);
  // A 1024 px (la larghezza minima con due colonne) la colonna del ranking è la più stretta: senza
  // min-w-0 la «Best build» su una riga la allargava e la pagina sbordava (fino a 1280 px).
  await page.setViewportSize({ width: 1024, height: 900 });
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('3. vista lame a 1024 px: nessuno scroll orizzontale', hScroll <= 0, `sborda di ${hScroll}px`);
  await page.setViewportSize({ width: 1366, height: 900 });
  const btc = await metricValues(page, rows, 'topCut');
  check('3. vista lame: top cut non crescenti', nonIncreasing(btc), btc.slice(0, 8).join(','));
  const shares = await shareValues(page);
  check('3. vista lame: quote mostrate <= 100%', shares.reduce((a, b) => a + b, 0) <= 100.5, `somma ${shares.reduce((a, b) => a + b, 0).toFixed(1)}`);
  const cxRows = page.locator(`${rows}[data-line=cx]`);
  if ((await cxRows.count()) > 0) check('3. una Main Blade CX è in classifica col badge CX', (await cxRows.first().locator('span', { hasText: /^CX$/ }).count()) > 0);
  else skipped('3. Main Blade CX in classifica', 'nessuna lama CX nelle prime righe a 30 giorni');
  // 9. Show more nella vista lame
  if (nBlades > PAGE_SIZE) {
    await page.getByTestId('load-more').click();
    check('9. Show more nella vista lame', (await bladeRows(page).count()) === Math.min(nBlades, PAGE_SIZE * 2), `=${await bladeRows(page).count()}`);
  } else check('9. vista lame sotto una pagina: niente Show more', (await page.getByTestId('load-more').count()) === 0);

  // 4. «Le build migliori per la lama X»: click sulla prima riga
  const firstRow = bladeRows(page).first();
  const focus = await firstRow.getAttribute('data-blade');
  const focusName = ((await firstRow.locator('span.font-display').nth(1).textContent()) ?? '').trim();
  await firstRow.click();
  check('4. click su una lama: si torna alle combo', (await visibleCards(page).count()) > 0 && (await bladeRows(page).count()) === 0);
  const focusedBlades = await page.locator(cards).evaluateAll((els) => els.map((e) => e.getAttribute('data-blade')));
  check('4. solo combo di quella lama', focusedBlades.length > 0 && focusedBlades.every((b) => b === focus), `${focus}: ${[...new Set(focusedBlades)].join(',')}`);
  check('4. titolo «Best combos for …»', /best combos for/i.test((await page.getByTestId('ranking-title').textContent()) ?? ''), `${focusName} / ${await page.getByTestId('ranking-title').textContent()}`);
  check('4. «Search parts» non toccato (nessuna parte selezionata)', (await page.locator('button[aria-label^="remove "]').count()) === 0);
  await page.getByTestId('blade-focus-clear').click();
  check('4. ✕ torna a tutte le combo del periodo', (await resultsCount(page)) === count30, `${await resultsCount(page)} vs ${count30}`);
  // Stesso percorso con una CX
  await page.getByTestId('view-blades').click();
  const cxRow = page.locator('[data-testid=blade-row][data-line=cx]').first();
  if ((await cxRow.count()) > 0) {
    const cxBlade = await cxRow.getAttribute('data-blade');
    await cxRow.click();
    const lines = await page.locator(cards).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-line')}:${e.getAttribute('data-blade')}`));
    check('4. lama CX: solo combo CX con quella Main Blade', lines.length > 0 && lines.every((l) => l === `cx:${cxBlade}`), lines.slice(0, 4).join(','));
    await page.getByTestId('blade-focus-clear').click();
  } else skipped('4. percorso con una lama CX', 'nessuna lama CX a 30 giorni');

  // 6. Niente filtri per linea e stadio né parti suggerite (tolti il 03/10/2026): il pannello ha la
  //    ricerca e i due filtri Tournament-proven e Meta / top-tier.
  const tolti = ['BX', 'UX', 'CX', 'Xtreme', 'Infinity'];
  const pillsTolte: string[] = [];
  for (const n of tolti) if ((await page.getByRole('button', { name: n, exact: true }).count()) > 0) pillsTolte.push(n);
  check('6. nessun filtro BX/UX/CX/Xtreme/Infinity', pillsTolte.length === 0, pillsTolte.join(','));
  check('6. nessuna sezione Suggested', (await page.getByText('Suggested', { exact: true }).count()) === 0);

  // 5. «Ho queste parti, cosa posso costruire?»
  await page.getByTestId('view-combos').click();
  await page.getByTestId('sort-score').click();
  await page.getByTestId('period-365').click();
  for (const q of ['Wizard Rod', '1-60', 'Hexa']) await addPart(page, q);
  check('5. Wizard Rod + 1-60 + Hexa: una sola combo, Wizard Rod 1-60 Hexa', (await resultsCount(page)) === 1 && (await firstCardId(page)) === 'wizard-rod-1-60-hexa', `${await resultsCount(page)} · ${await firstCardId(page)}`);
  await page.locator('button[aria-label="remove Hexa"]').click();
  const wr160 = await page.locator(`${cards}`).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-line')}:${e.getAttribute('data-blade')}`));
  check('5. Wizard Rod + 1-60: nessuna CX e nessun ratchet integrato, solo Wizard Rod', wr160.length > 0 && wr160.every((x) => x === 'bx:wizard-rod'), wr160.slice(0, 4).join(','));
  await page.getByTestId('view-blades').click();
  const rowsWr = await bladeRows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-blade')));
  check('5. vista lame con la ricerca: solo Wizard Rod', rowsWr.length === 1 && rowsWr[0] === 'wizard-rod', rowsWr.join(','));
  await page.getByTestId('sort-wins').click();
  check('5. cambiando ordinamento la ricerca resta', (await page.locator('button[aria-label^="remove "]').count()) === 2);

  // UX: stessa struttura delle BX. Fino al 01/10/2026 il nome di una UX era il solo bit («Kick»).
  await page.locator('button[aria-label^="remove "]').evaluateAll((els) => els.forEach((e) => (e as HTMLButtonElement).click()));
  // Le UX si prendono dal ranking così com'è: il filtro per linea non c'è più (03/10/2026).
  await page.getByTestId('view-combos').click();
  const uxNames = await page.locator(`${cards}[data-line=ux] h3`).allTextContents();
  if (uxNames.length > 0) check('nomi delle combo UX con la lama, non il solo bit', uxNames.every((n) => n.trim().split(/\s+/).length >= 2), uxNames.slice(0, 3).join(' | '));
  else skipped('nomi delle combo UX', 'nessuna combo UX nella prima pagina');

  check('nessun errore in console (ranking)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.screenshot({ path: join(SHOTS, 'home-desktop-blades.png'), fullPage: false });
  await page.close();
}

/** [17] Caso 8: primi istanti (dataset in arrivo) e dataset bloccato. */
async function datasetFlow(browser: Browser) {
  console.log('\n[17] Dataset: caricamento e guasto');
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/combos.json', async (route) => { await gate; await route.continue(); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=period-hint]');
  check('caricamento: stato loading', (await page.getByTestId('period-hint').getAttribute('data-dataset')) === 'loading');
  check('caricamento: contatore = combo inline', (await resultsCount(page)) === INLINE, `=${await resultsCount(page)}`);
  const disabled = await page.locator('[aria-disabled=true]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  check('caricamento: disabilitati 30D 90D 180D, Top cuts, Wins, Blades',
    JSON.stringify(disabled.sort()) === JSON.stringify(['period-180', 'period-30', 'period-90', 'sort-topCut', 'sort-wins', 'view-blades']), disabled.join(','));
  await page.getByTestId('sort-topCut').click({ force: true });
  check('caricamento: un clic su un controllo disabilitato non cambia nulla', (await page.getByTestId('sort-score').getAttribute('aria-pressed')) === 'true');
  release();
  await waitDataset(page);
  check('arrivato il dataset: ready e nessun controllo disabilitato', (await page.getByTestId('period-hint').getAttribute('data-dataset')) === 'ready' && (await page.locator('[aria-disabled=true]').count()) === 0);
  await page.close();

  const broken = await ctx.newPage();
  await broken.route('**/combos.json', (route) => route.abort());
  await broken.goto(BASE + '/', { waitUntil: 'networkidle' });
  await broken.waitForFunction(() => document.querySelector('[data-testid=period-hint]')?.getAttribute('data-dataset') === 'failed', null, { timeout: 10_000 }).catch(() => {});
  check('dataset bloccato: stato failed col messaggio', (await broken.getByTestId('period-hint').getAttribute('data-dataset')) === 'failed'
    && /unavailable/i.test((await broken.getByTestId('period-hint').textContent()) ?? ''));
  check('dataset bloccato: restano le 30 combo e i controlli disabilitati', (await resultsCount(broken)) === INLINE && (await broken.locator('[aria-disabled=true]').count()) === 6);
  await broken.close();
  await ctx.close();
}

async function mobileFlow(context: BrowserContext) {
  const page = await context.newPage();
  const errs = consoleErrors(page);
  console.log('\n[12] Mobile 390x844');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await waitDataset(page);
  const noHScroll = async () => (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390;
  check('nessuno scroll orizzontale (home)', await noHScroll(), `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  // Da telefono la home deve portare alle sezioni: prima le voci erano nascoste sotto i 640 px.
  const navMobile = page.locator('[data-testid=mobile-nav] a:visible');
  check('menu sezioni visibile su mobile (Meta · Guides)', JSON.stringify((await navMobile.allTextContents()).map((x) => x.trim().toLowerCase())) === '["meta","guides"]', (await navMobile.allTextContents()).join(','));
  await addPart(page, 'Wizard Rod');
  check('parte aggiunta su mobile', (await page.locator('button[aria-label="remove Wizard Rod"]').count()) === 1);
  await page.getByTestId('period-30').click();
  check('30D su mobile: contatore leggibile', (await resultsCount(page)) >= 0);
  check('nessuno scroll orizzontale (ricerca attiva)', await noHScroll());
  await page.screenshot({ path: join(SHOTS, 'home-mobile-30d-search.png'), fullPage: false });
  await page.getByTestId('sort-topCut').click();
  await page.getByTestId('view-blades').click();
  check('vista lame su mobile: righe visibili', (await bladeRows(page).count()) > 0);
  check('nessuno scroll orizzontale (vista lame)', await noHScroll(), `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  await page.screenshot({ path: join(SHOTS, 'home-mobile-blades.png'), fullPage: false });
  await page.getByTestId('view-combos').click();
  await page.getByTestId('period-365').click();
  await page.screenshot({ path: join(SHOTS, 'home-mobile-365d.png'), fullPage: false });
  check('nessun errore in console (mobile)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  console.log(`e2e-smoke su ${BASE}`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
    await desktopFlow(desktop);
    await rankingFlow(desktop);
    await editorialFlow(desktop);
    await desktop.close();
    await countryFlow(browser);
    await datasetFlow(browser);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true });
    await mobileFlow(mobile);
    await mobile.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${pass} OK, ${fail} KO, ${skip} SKIP. Screenshot in ${SHOTS}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('e2e-smoke: errore fatale', e); process.exit(1); });
