---
name: web-frontend
status: active
updated: 12/09/2026
health: green
next-step: ""
blocked-by: null
current-plan: plans/monetizzazione-analytics-filtro-periodo-2026-09-11-1500.md
main-doc: CLAUDE.md
---

# Sito web (Astro + Preact)

## Scope

Il sito statico (Astro SSG + island Preact, Tailwind v4, **monolingua inglese** servito dalla root)
che consuma `data/combos.json` e `data/parts.json` per la ricerca combo client-side. Include i
selettori parte per linea (BX/UX e CX), i badge di autorevolezza CAS e i filtri torneo. Deploy su
GitHub Pages via Actions. L'infrastruttura i18n IT resta in repo (dormiente), riattivabile in futuro.

## Backlog

<!-- Idee, feature, task non avviati. Formato: `- gg/mm/aaaa — testo` -->
- 16/06/2026 — pagine dettaglio combo `/combo/[id]` (SSG) per SEO (non ancora implementate)
- 16/06/2026 — SEO: structured data JSON-LD (la sitemap c'è dall'11/09/2026)
- 16/06/2026 — registrare Amazon Associates US: oggi i visitatori fuori da IT/DE/FR/ES/UK/JP vanno su amazon.com **senza tag** (`data/amazon-config.json`, `com` vuoto), quindi zero ricavo sul pubblico americano, probabilmente il più grande per un sito in inglese
- 11/09/2026 — Link «Buy» solo sui chip delle parti mancanti con Compare attivo: superficie monetizzabile ristretta. Decidere con i dati PostHog (`amazon_click` vs `search_results`) se aggiungere una riga «Buy the missing parts» sempre visibile sulla card
- 11/09/2026 — Vale la pena rendere `INITIAL_COMBOS`/`PAGE` scroll-infinito invece del bottone «Show more»? Guardare l'evento `load_more` in PostHog prima di toccare

## Known issues

<!-- Bug noti, problemi aperti, debiti tecnici. Formato: `- gg/mm/aaaa — testo` -->

## In progress

<!-- Lavori in corso. Se collegati a un piano in plans/, linkalo. -->
- 12/09/2026 — **AdSense in revisione**: sito verificato e revisione richiesta il 12/09. Resta: all'approvazione creare le unità annuncio in AdSense e mettere gli id in `src/lib/ads-config.ts` (`AD_SLOTS`), poi controllare che il messaggio di consenso compaia in EEA

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 12/09/2026 — **Tag Associates dedicati e AdSense avviato**. Creati via Claude in Chrome i tracking ID bxcombos-21 (es), bxcombosde-21, bxcombosfr-21, bxcombosuk-21, bxcombos-22 (jp) e scritti in `data/amazon-config.json` (verificati nell'HTML pubblicato); beybladexcombos.com aggiunto alla lista siti dei 5 account. L'account IT non esiste più: `it` resta senza tag. AdSense: sito aggiunto all'account pub-7303361297226779, script in head e `public/ads.txt` pubblicati, proprietà verificata, revisione richiesta, CMP di Google a 3 scelte attivata. Gotcha: gli ID `-21` sono uno spazio di nomi unico fra i marketplace EU
- 12/09/2026 — **Dominio beybladexcombos.com e PostHog attivi**. DNS su Tophost (4 A + AAAA su @, CNAME www → albertocabasvidani.github.io), custom domain e Enforce HTTPS su GitHub Pages via `gh api`, `public/CNAME` e default di `astro.config.mjs` sulla root; il vecchio URL github.io redirige (301). Chiave del progetto PostHog EU (id 272532) in `analytics-config.ts`, Session replay acceso e `cookieless_server_hash_mode` portato a 2 via API (a 0, il default, l'ingest rispondeva 200 ma scartava tutti gli eventi cookieless: nessun evento in Activity finché non è stato cambiato; ora `part_added`/`search_results`/`period_changed` compaiono). Verifiche sul sito vero: home 312 KB, `combos.json` 200, e2e 42/42 con `E2E_URL=https://beybladexcombos.com`; ingest PostHog 200 da un Chrome pulito (UA normale) e evento `curl_probe` visibile in Activity. Trappole misurate: posthog-js scarta gli eventi da browser headless/webdriver (un probe headless non manda nulla, serve UA normale + `navigator.webdriver=false`); nel Chrome dell'utente le POST a `eu.i.posthog.com` falliscono («Failed to fetch», estensione che blocca), quindi il suo traffico non compare in PostHog
- 11/09/2026 — **SEO, privacy, predisposizione dominio e AdSense**. `astro.config.mjs` legge `SITE_ORIGIN`/`SITE_BASE` (default GitHub Pages) e monta `@astrojs/sitemap` (solo pagine HTML); `src/pages/robots.txt.ts` genera robots con l'URL della sitemap coerente; layout con canonical (slash finale come la sitemap) e Open Graph/Twitter card con `public/og.png` (1200×630, generata con sharp da `tmp/gen-og.mjs`). Pagina `/privacy/` (chi siamo, PostHog cookieless, AdSense e consenso Google, affiliazione Amazon, preferenze locali, diritti), link nel footer. AdSense predisposto e spento: `src/lib/ads-config.ts` vuoto → nessuno script né slot; `ad-slot.astro` sopra e sotto l'isola. Cartelle vuote `src/pages/api/buy/` rimosse. Build di prova in modalità dominio (`SITE_BASE=/`): link radice, robots/sitemap/og su beybladexcombos.com, e2e 41/42 (l'unico KO era il test stesso: build senza chiave PostHog di prova). Il passaggio vero al dominio è documentato in CLAUDE.md e scatta quando l'utente ha registrato il dominio: fino ad allora il sito resta sul github.io
- 11/09/2026 — **Analytics PostHog cookieless (cloud EU)** — `src/lib/analytics.ts` (`cookieless_mode: 'always'`: niente cookie né storage, niente banner; no-op in dev e finché la chiave in `analytics-config.ts` è il placeholder). Eventi: `part_added`/`part_removed`, `search_results` (fotografia della ricerca con debounce 500 ms), `filter_toggled` (compare, tournament, meta, buildable, linea, stadio), `period_changed`, `load_more`, `marketplace_changed`, `amazon_click`, `theme_toggled` (header), `source_click` (about). Cablaggio verificato con una chiave di prova: la preview contatta `eu.i.posthog.com` e non scrive cookie né localStorage (e2e verde). La chiave vera la mette l'utente
- 11/09/2026 — **Amazon riattivato**: link «Buy» sui chip delle parti mancanti (Compare attivo), `rel=sponsored`, marketplace dalle lingue del browser con select «Shop on» persistito, `/dp/ASIN` dove `data/amazon-asins.json` conosce il set (52 codici dal monitor, `npm run sync:amazon-asins`), altrimenti ricerca per nome (blade & co.) o per codice set (ratchet/bit). Tag per marketplace in `data/amazon-config.json` (tracking ID dedicati al sito, oggi vuoti). `buildPartLookup` preferisce i codici Takara Tomy a quelli Hasbro (bug latente: `accel → G1536`, 0 risultati su Amazon EU). Disclosure nel footer, sezione affiliazione in about. `npm run test:amazon` (20 controlli)
- 11/09/2026 — **Home da 38,5 MB a 279 KB** (31 KB gzip). `index.astro` passava tutto `combos.json` (19 MB con l'evidenza) come prop dell'isola Preact, e Astro lo serializza in un attributo HTML dove ogni `"` diventa `&quot;`: il doppio. Ora `src/lib/slim-combos.ts` proietta le combo sui soli campi usati dalla UI, l'endpoint `src/pages/combos.json.ts` le serve come asset separato (2,46 MB, 174 KB gzip) e l'isola parte con 30 combo inline (solo finestra 12M) e fetcha il resto. **Filtro periodo** 1M/3M/6M/12M (pill sopra il ranking, default 12M): ordina su `windows[p].score`, nasconde le combo senza risultati nella finestra, badge e filtri Tournament-proven/Meta valutano la finestra. **Paginazione** «Show more» a 60 card (prima 4.000 combo × 2 `<article>` in DOM). `score-badge.tsx` prende score/tag/soglie invece della combo; `search-engine.ts` lavora su `SlimCombo` con `period` obbligatorio; via `topCombosForBlade` (inutilizzata) e la chiave i18n orfana `search.showAll`. **`npm run test:e2e`** (`scripts/e2e-smoke.ts`, playwright-core + Chrome): percorso utente completo su desktop e mobile 390 px, 34 controlli verdi e 4 SKIP sulle parti Amazon/privacy non ancora fatte; `data-testid` su card, badge, pill periodo, contatore, Show more, chip owned/missing
- 17/06/2026 — sito monolingua EN su root (rimosso redirect a `/en/`, eliminate route `/en/` e `/it/`, about su `/about/`, header senza selettore lingua); pagina about: fonti ridotte a nome+link (tolti weight e chip type), filtrate alle fonti del CAS
- 16/06/2026 — badge di autorevolezza (CAS) + filtri torneo nella ricerca
