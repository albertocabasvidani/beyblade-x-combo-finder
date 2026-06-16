---
name: parts-database
status: active
updated: 16/06/2026
health: green
next-step: "mantenere verify:wiki a 0 mancanti"
blocked-by: null
current-plan: plans/ripresa-pipeline-beyblade-x-over-blade-bonifica-pa-2026-06-15-1731.md
main-doc: CLAUDE.md
---

# Database parti master multilingua

## Scope

Registro canonico delle parti Beyblade X (`data/parts-master.json`) costruito dall'IA leggendo le
pagine prodotto del Fandom Wiki via API MediaWiki, con nomi TT/Hasbro/JP/romaji + alias multilingua.
Da qui `npm run build:parts` deriva `parts.json` (consumato dal sito) preservando gli id referenziati
da `combos.json`/`products.json`. Copre import iniziale, update giornaliero a diff revid, verifica
contro il wiki e modellazione delle categorie (incl. Over Blade per CX Expand).

## Backlog

<!-- Idee, feature, task non avviati. Formato: `- gg/mm/aaaa — testo` -->
- 16/06/2026 — revisionare i casi ambigui in `data/parts-master-conflicts.json` (revisione umana)

## Known issues

<!-- Bug noti, problemi aperti, debiti tecnici. Formato: `- gg/mm/aaaa — testo` -->
- 16/06/2026 — pagina `/wiki/` dà 403 (Cloudflare): si accede solo via API MediaWiki (`api.php?action=parse&prop=wikitext`)

## In progress

<!-- Lavori in corso. Se collegati a un piano in plans/, linkalo. -->

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 16/06/2026 — docs: README/CLAUDE.md aggiornati per pipeline e confine IA/codice
- 15/06/2026 — modellato Over Blade come categoria a sé (`overBlades`) + bonifica DB parti
- 15/06/2026 — `npm run verify:wiki` contro fonte affidabile (category per-tipo X-pure) + ripristino L-Drago
