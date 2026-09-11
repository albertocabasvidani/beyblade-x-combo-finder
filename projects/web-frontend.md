---
name: web-frontend
status: active
updated: 11/09/2026
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
- 16/06/2026 — SEO: sitemap + structured data JSON-LD
- 16/06/2026 — registrare Amazon Associates US (tag `AMAZON_TAG_US` attualmente vuoto)

## Known issues

<!-- Bug noti, problemi aperti, debiti tecnici. Formato: `- gg/mm/aaaa — testo` -->

## In progress

<!-- Lavori in corso. Se collegati a un piano in plans/, linkalo. -->
- 11/09/2026 — **Monetizzazione e analytics** (piano `plans/monetizzazione-analytics-filtro-periodo-2026-09-11-1500.md`): fatte le fasi 1-3 (parser WBO, score per finestra, pagina leggera + filtro periodo). Resta: PostHog cookieless EU (F4), link Amazon con tracking ID dedicati + ASIN dal monitor (F5), dominio beybladexcombos.com + sitemap/OG + AdSense + privacy (F6), riattivazione `/update-combos` sul server (F7), giro col browser MCP sul sito pubblicato (F8.2)

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 11/09/2026 — **Home da 38,5 MB a 279 KB** (31 KB gzip). `index.astro` passava tutto `combos.json` (19 MB con l'evidenza) come prop dell'isola Preact, e Astro lo serializza in un attributo HTML dove ogni `"` diventa `&quot;`: il doppio. Ora `src/lib/slim-combos.ts` proietta le combo sui soli campi usati dalla UI, l'endpoint `src/pages/combos.json.ts` le serve come asset separato (2,46 MB, 174 KB gzip) e l'isola parte con 30 combo inline (solo finestra 12M) e fetcha il resto. **Filtro periodo** 1M/3M/6M/12M (pill sopra il ranking, default 12M): ordina su `windows[p].score`, nasconde le combo senza risultati nella finestra, badge e filtri Tournament-proven/Meta valutano la finestra. **Paginazione** «Show more» a 60 card (prima 4.000 combo × 2 `<article>` in DOM). `score-badge.tsx` prende score/tag/soglie invece della combo; `search-engine.ts` lavora su `SlimCombo` con `period` obbligatorio; via `topCombosForBlade` (inutilizzata) e la chiave i18n orfana `search.showAll`. **`npm run test:e2e`** (`scripts/e2e-smoke.ts`, playwright-core + Chrome): percorso utente completo su desktop e mobile 390 px, 34 controlli verdi e 4 SKIP sulle parti Amazon/privacy non ancora fatte; `data-testid` su card, badge, pill periodo, contatore, Show more, chip owned/missing
- 17/06/2026 — sito monolingua EN su root (rimosso redirect a `/en/`, eliminate route `/en/` e `/it/`, about su `/about/`, header senza selettore lingua); pagina about: fonti ridotte a nome+link (tolti weight e chip type), filtrate alle fonti del CAS
- 16/06/2026 — badge di autorevolezza (CAS) + filtri torneo nella ricerca
