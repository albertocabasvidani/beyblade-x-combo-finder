/**
 * e2e-smoke.ts — percorre il sito come un utente (Chrome di sistema via playwright-core, headless)
 * e verifica peso della pagina, dataset separato, ricerca parti, filtro periodo, filtri, paginazione,
 * link Amazon, marketplace, tema, pagine secondarie, mobile. Stampa OK/KO per passo ed esce 1 se un
 * passo fallisce. Screenshot in tmp/e2e/.
 *
 * Precondizione: `npm run build && npm run preview` in un altro terminale (porta 4321).
 * Esegui: npm run test:e2e            (E2E_URL per un'altra origine, es. https://beybladexcombos.com)
 */
import { chromium, type Page, type BrowserContext, type Response } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'fs';
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

async function addPart(page: Page, query: string) {
  const input = page.locator('input[type=text]').first();
  await input.click();
  await input.fill(query);
  await page.locator('ul li button').first().click();
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

  console.log('[4] Cerca e aggiunge una parte');
  await addPart(page, 'Wizard Rod');
  check('chip "remove Wizard Rod" presente', (await page.locator('button[aria-label="remove Wizard Rod"]').count()) === 1);
  check('titolo ranking in modalita solo-blade', (await page.locator('h2').filter({ hasText: 'Wizard Rod' }).count()) > 0);
  const bladeCount = await resultsCount(page);
  check('contatore sceso', bladeCount > 0 && bladeCount < total, `${total} -> ${bladeCount}`);

  console.log('[5] Periodo');
  const first12 = await firstCardId(page);
  const count12 = await resultsCount(page);
  await page.getByTestId('period-1').click();
  const count1 = await resultsCount(page);
  check('1M: contatore <= 12M', count1 <= count12, `${count1} vs ${count12}`);
  check('1M: hint del periodo aggiornato', /last month/i.test((await page.getByTestId('period-hint').textContent()) ?? ''));
  const badges = await page.locator('[data-testid=score-badge]:visible').allTextContents();
  check('1M: ogni badge ha un numero', badges.length === Math.min(count1, PAGE_SIZE) && badges.every((b) => /^\d+\.\d/.test(b.trim())), `${badges.length} badge`);
  await page.getByTestId('period-3').click();
  check('3M: contatore fra 1M e 12M', (await resultsCount(page)) >= count1 && (await resultsCount(page)) <= count12);
  await page.getByTestId('period-12').click();
  check('12M: stessa prima card di prima', (await firstCardId(page)) === first12, `${first12} vs ${await firstCardId(page)}`);
  check('12M: stesso contatore di prima', (await resultsCount(page)) === count12);

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
  if (panelMarket !== 'com') check('link del pannello con tracking ID', panelHrefs.every((h) => /[?&]tag=/.test(h.href)), panelHrefs[0]?.href);
  await toggles.first().click();
  check('pannello richiuso', (await page.locator('[data-testid=buy-parts-panel]').count()) === 0);

  console.log('[8] Compare + Buy');
  // Blade + bit: con la sola blade il ranking si restringe a quella blade e nessun chip risulta
  // mancante (ratchet/bit non selezionati = "unset"). Col bit selezionato le combo con altro bit
  // mostrano il chip "!".
  await addPart(page, 'Wizard Rod');
  await addPart(page, 'Hexa');
  await page.locator('button[role=switch]').click();
  check('switch Compare attivo', (await page.locator('button[role=switch]').getAttribute('aria-checked')) === 'true');
  const missingChips = page.locator('[data-testid=combo-card]:visible [data-testid=part-missing]');
  check('chip parti mancanti visibili', (await missingChips.count()) > 0, `=${await missingChips.count()}`);
  const buy = page.locator('[data-testid=combo-card]:visible a[data-testid=buy]');
  if ((await buy.count()) === 0) skipped('link Buy', 'nessun link Buy nella pagina (Amazon non ancora attivo)');
  else {
    const hrefs = await buy.evaluateAll((as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })));
    check('ogni Buy punta ad amazon.', hrefs.every((h) => /^https:\/\/www\.amazon\./.test(h.href)), hrefs[0]?.href);
    check('ogni Buy ha target=_blank e rel sponsored', hrefs.every((h) => h.target === '_blank' && /sponsored/.test(h.rel)));
    const market = await page.getByTestId('marketplace').inputValue();
    const tagged = hrefs.filter((h) => /[?&]tag=/.test(h.href)).length;
    if (market === 'com') check('amazon.com: nessun tag (nessun account US)', tagged === 0, `${tagged} con tag`);
    else check(`mercato ${market}: tutti i link con tag`, tagged === hrefs.length, `${tagged}/${hrefs.length}`);
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
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const footer = (await page.locator('footer').textContent()) ?? '';
  if (/Amazon Associate/i.test(footer)) check('footer: disclosure Amazon', true); else skipped('footer: disclosure Amazon', 'non ancora presente');

  console.log('[13] Screenshot desktop');
  await waitDataset(page);
  await page.screenshot({ path: join(SHOTS, 'home-desktop-12m.png'), fullPage: false });
  await page.getByTestId('period-1').click();
  await page.screenshot({ path: join(SHOTS, 'home-desktop-1m.png'), fullPage: false });
  await page.close();
}

async function mobileFlow(context: BrowserContext) {
  const page = await context.newPage();
  const errs = consoleErrors(page);
  console.log('\n[12] Mobile 390x844');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await waitDataset(page);
  const noHScroll = async () => (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390;
  check('nessuno scroll orizzontale (home)', await noHScroll(), `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  await addPart(page, 'Wizard Rod');
  check('parte aggiunta su mobile', (await page.locator('button[aria-label="remove Wizard Rod"]').count()) === 1);
  await page.getByTestId('period-1').click();
  check('1M su mobile: contatore leggibile', (await resultsCount(page)) >= 0);
  await page.locator('button[role=switch]').click();
  check('nessuno scroll orizzontale (compare attivo)', await noHScroll());
  await page.screenshot({ path: join(SHOTS, 'home-mobile-1m-compare.png'), fullPage: false });
  await page.getByTestId('period-12').click();
  await page.screenshot({ path: join(SHOTS, 'home-mobile-12m.png'), fullPage: false });
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
    await desktop.close();
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
