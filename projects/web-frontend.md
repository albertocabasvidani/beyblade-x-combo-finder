---
name: web-frontend
status: active
updated: 16/06/2026
health: green
next-step: ""
blocked-by: null
current-plan: null
main-doc: CLAUDE.md
---

# Sito web (Astro + Preact)

## Scope

Il sito statico (Astro SSG + island Preact, Tailwind v4, i18n EN/IT route-based) che consuma
`data/combos.json` e `data/parts.json` per la ricerca combo client-side. Include i selettori parte
per linea (BX/UX e CX), i badge di autorevolezza CAS, i filtri torneo, e i link Amazon affiliate sui
badge delle parti mancanti. Deploy su GitHub Pages via Actions.

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
- 16/06/2026 — badge di autorevolezza (CAS) + filtri torneo nella ricerca
