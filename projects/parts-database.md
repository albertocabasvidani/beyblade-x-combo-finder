---
name: parts-database
status: active
updated: 20/08/2026
health: green
next-step: "mantenere verify:wiki a 0 mancanti; verificare periodicamente le 3 parti senza immagine"
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
- 20/08/2026 — 3 parti senza immagine dopo il backfill di `sync-part-images.ts`, non risolvibili dalla catena di fallback: `tiga` (Lock Chip), `i` (Over Blade), `low-point` (Bit). Tutte e tre pagine `Beyblade X (Season 3)`: l'infobox referenzia un file (rispettivamente `LockChipTiga.png`, `OverBladeI.png`, `BitLowPoint.png`) mai caricato sulla wiki — `action=query&prop=imageinfo` risponde `missing` — e non c'è nessun'altra immagine embedded nella pagina (`Lock Chip - Tiga` ha anche l'icona `Icon Unreleased.svg`). Non è un bug dello script: sul wiki non esiste ancora nessuna foto per queste 3 parti. Nessun override possibile finché qualcuno non carica il file; da riverificare nei prossimi `/update-parts` (`npm run sync:part-images` è idempotente, riprova da solo quando la pagina cambia)

## In progress

<!-- Lavori in corso. Se collegati a un piano in plans/, linkalo. -->

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 20/08/2026 — Immagini dei componenti: nuovo `scripts/sync-part-images.ts` (`npm run sync:part-images`, devDependency `sharp`), integrato in `/update-parts` punto 4 prima di `build:parts`. Match parte→pagina wiki per prefisso titolo + chiavi normalizzate (269+/277 pagine), catena di fallback sull'URL immagine (pageimages → infobox wikitext → lista immagini pagina → pagina prodotto → `data/image-overrides.json` manuale). Backfill iniziale: **274/277 parti con immagine** scaricata da Fandom, ridimensionata 512×512 in `public/images/parts/<id>.png` (**68 MB**, misurato con `du -sh` — non i ~14 MB stimati inizialmente), campo `image` propagato in `parts.json` da `build-parts.ts`. 3 parti restano senza immagine, vedi Known issues. Idempotenza verificata: una seconda run non riscarica nulla
- 28/07/2026 — `/update-parts`: nessuna parte nuova. Le due liste prodotti TT/Hasbro invariate. 12 pagine con revid cambiato, tutte per il nuovo G3084 Rival Rumble Pack (Hasbro, repackaging di colorazioni già registrate: Pearl Tiger 3-60U, Wriggle Kraken S 3-85O, Sterling Wolf 3-80FB, Crest Leon 7-60GN, Gill Shark 4-70O, HornetFort R7-60T) e mention aggiuntive sulla stessa Bit - Gear Needle (G3392 Ridge Triceratops 9-80GN, G3393 Yggdrasil Team Pack, G4565 Tread Croc TQ 5-50GN, tutte combo di parti già registrate)
- 27/07/2026 — `/update-parts`: nessuna parte nuova. Le due liste prodotti TT/Hasbro invariate dal 23/07. 3 pagine con revid cambiato (LeonCrest 7-60GN, SilverWolf 3-80FB, WeissTiger 3-60U): solo metadata release occidentale/gallery, nessun campo schema. Verificati a fondo anche 2 prodotti CX non ancora tracciati (Fang Leon T 4-60U, TigaRage FT3-60T) e le 11 pagine-registro linkate dalle liste (Blade/Ratchet/Bit/Lock Chip/Main Blade/Assist Blade "-"): tutte parti già a registro. 2 prodotti restano non estraibili perché ancora {{Unreleased}} con nomi parte non confermati (Tread Croc TQ 5-50GN: assist blade "Q" e over blade "T" senza nome ufficiale; Seize Jaguar HN: blade non ancora nominato)
- 26/07/2026 — `/update-parts`: nessuna parte nuova. Verificati a fondo i 3 nuovi Random Booster (Vol. 10, Vol. 11, BrachioWhip Select, 13 bey): tutti ricombinazioni di parti già registrate. Revid `BahamutBlitz BK1-50I` aggiornato (edit sul wiki annullato dalla community, nessun impatto sui dati)
- 16/06/2026 — docs: README/CLAUDE.md aggiornati per pipeline e confine IA/codice
- 15/06/2026 — modellato Over Blade come categoria a sé (`overBlades`) + bonifica DB parti
- 15/06/2026 — `npm run verify:wiki` contro fonte affidabile (category per-tipo X-pure) + ripristino L-Drago
