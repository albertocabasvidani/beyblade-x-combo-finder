---
name: web-frontend
status: active
updated: 17/06/2026
health: green
next-step: ""
blocked-by: null
current-plan: null
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

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 17/06/2026 — sito monolingua EN su root (rimosso redirect a `/en/`, eliminate route `/en/` e `/it/`, about su `/about/`, header senza selettore lingua); pagina about: fonti ridotte a nome+link (tolti weight e chip type), filtrate alle fonti del CAS
- 16/06/2026 — badge di autorevolezza (CAS) + filtri torneo nella ricerca
