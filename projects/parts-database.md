---
name: parts-database
status: active
updated: 27/07/2026
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
- 27/07/2026 — `/update-parts`: nessuna parte nuova. Le due liste prodotti TT/Hasbro invariate dal 23/07. 3 pagine con revid cambiato (LeonCrest 7-60GN, SilverWolf 3-80FB, WeissTiger 3-60U): solo metadata release occidentale/gallery, nessun campo schema. Verificati a fondo anche 2 prodotti CX non ancora tracciati (Fang Leon T 4-60U, TigaRage FT3-60T) e le 11 pagine-registro linkate dalle liste (Blade/Ratchet/Bit/Lock Chip/Main Blade/Assist Blade "-"): tutte parti già a registro. 2 prodotti restano non estraibili perché ancora {{Unreleased}} con nomi parte non confermati (Tread Croc TQ 5-50GN: assist blade "Q" e over blade "T" senza nome ufficiale; Seize Jaguar HN: blade non ancora nominato)
- 26/07/2026 — `/update-parts`: nessuna parte nuova. Verificati a fondo i 3 nuovi Random Booster (Vol. 10, Vol. 11, BrachioWhip Select, 13 bey): tutti ricombinazioni di parti già registrate. Revid `BahamutBlitz BK1-50I` aggiornato (edit sul wiki annullato dalla community, nessun impatto sui dati)
- 16/06/2026 — docs: README/CLAUDE.md aggiornati per pipeline e confine IA/codice
- 15/06/2026 — modellato Over Blade come categoria a sé (`overBlades`) + bonifica DB parti
- 15/06/2026 — `npm run verify:wiki` contro fonte affidabile (category per-tipo X-pure) + ripristino L-Drago
