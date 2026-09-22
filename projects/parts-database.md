---
name: parts-database
status: active
updated: 22/09/2026
health: green
next-step: "products-wiki.json: qualche giorno di run a mano guardando il diff, poi agganciarlo a /update-parts e farlo confluire in releases.json"
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
- 22/09/2026 — `products-wiki.json` in osservazione prima di entrare nella pipeline. Resta: (1) qualche giorno di `npm run build:products-wiki` a mano guardando il **diff** del file e gli `unresolved` nuovi — se il diff è rumoroso il determinismo non è completo; (2) decidere i 9 codici contesi fra due confezioni (`BX-07`, `BX-37`, `BX-46`, `UX-21`, `F9588`, `G0842`, `G1844`, `G1940`, `G3745`), dove `owner` finisce sul componente invece che sul set e il listino ne risente; (3) correggere in `products.json` i 2 id parte sbagliati che la verifica ha trovato, o lasciarli morire quando il generato lo sostituisce; (4) punto 6-bis in `.claude/commands/update-parts.md`, **sempre eseguito** (un prodotto nuovo può comparire senza nessuna parte nuova: è il caso CX-17, le cui parti erano già tutte a registro); (5) far confluire il catalogo in `releases.json` dietro interruttore, con guardia sul calo del numero di prodotti

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 22/09/2026 — **Catalogo prodotti generato dal wiki** (`scripts/build-products-wiki.ts` → `data/products-wiki.json`, parser riusabile in `scripts/lib/wiki-infobox.ts`, verifica in `scripts/test-products-wiki.ts`). Nasce da un guasto a valle: `data/products.json` è fermo dal 14/08 e nessuno script lo scrive, quindi 49 codici che le parti nominano non arrivano in `releases.json` e bbxdealmonitor non ne conosce il listino — il 22/09 un CX-17 a 85 € (9,6× il listino di 8,85 €) è passato dal filtro prezzo perché il filtro non aveva un listino. Il generatore legge l'infobox delle 310 pagine-prodotto, dove `ProductCode` dichiara **entrambi** i codici ufficiali sulla stessa riga: la corrispondenza TT↔Hasbro diventa un dato scritto invece che dedotto dai nomi. Deterministico (nessuna IA: il file si rigenera ogni giorno e il diff deve essere solo ciò che cambia sul wiki), cache per revid + `parserVersion`, `unresolved` accumulato come `parts-master-conflicts.json`. **Misurato contro `products.json`: +63 codici, 0 persi**, 2 disaccordi sulle parti in cui ha torto il catalogo vecchio, 80 coppie TT↔Hasbro, 62 codici che guadagnano un listino. 19 casi irrisolti, tutti dichiarati (9 codici che due confezioni si contendono, 4 blade di collaborazioni assenti dal master, 3 nomi Hasbro dove il redirect è il nome di un set, 1 link rosso, 1 codice noto solo a una pagina-parte, 1 `(Hasbro)` su un codice `BX-00`). Quattro funzioni di `scan-wiki-updates.ts` esportate per riuso (`pulisciCellaData`, `estraiDataPiuAntica`, `normalizzaNome`, `inEuro`): le date **devono** nascere dallo stesso parser delle liste, o il confronto fra generato e liste confronterebbe due parser invece di due fonti
- 20/08/2026 — Immagini dei componenti: nuovo `scripts/sync-part-images.ts` (`npm run sync:part-images`, devDependency `sharp`), integrato in `/update-parts` punto 4 prima di `build:parts`. Match parte→pagina wiki per prefisso titolo + chiavi normalizzate (269+/277 pagine), catena di fallback sull'URL immagine (pageimages → infobox wikitext → lista immagini pagina → pagina prodotto → `data/image-overrides.json` manuale). Backfill iniziale: **274/277 parti con immagine** scaricata da Fandom, ridimensionata 512×512 in `public/images/parts/<id>.png` (**68 MB**, misurato con `du -sh` — non i ~14 MB stimati inizialmente), campo `image` propagato in `parts.json` da `build-parts.ts`. 3 parti restano senza immagine, vedi Known issues. Idempotenza verificata: una seconda run non riscarica nulla
- 28/07/2026 — `/update-parts`: nessuna parte nuova. Le due liste prodotti TT/Hasbro invariate. 12 pagine con revid cambiato, tutte per il nuovo G3084 Rival Rumble Pack (Hasbro, repackaging di colorazioni già registrate: Pearl Tiger 3-60U, Wriggle Kraken S 3-85O, Sterling Wolf 3-80FB, Crest Leon 7-60GN, Gill Shark 4-70O, HornetFort R7-60T) e mention aggiuntive sulla stessa Bit - Gear Needle (G3392 Ridge Triceratops 9-80GN, G3393 Yggdrasil Team Pack, G4565 Tread Croc TQ 5-50GN, tutte combo di parti già registrate)
- 27/07/2026 — `/update-parts`: nessuna parte nuova. Le due liste prodotti TT/Hasbro invariate dal 23/07. 3 pagine con revid cambiato (LeonCrest 7-60GN, SilverWolf 3-80FB, WeissTiger 3-60U): solo metadata release occidentale/gallery, nessun campo schema. Verificati a fondo anche 2 prodotti CX non ancora tracciati (Fang Leon T 4-60U, TigaRage FT3-60T) e le 11 pagine-registro linkate dalle liste (Blade/Ratchet/Bit/Lock Chip/Main Blade/Assist Blade "-"): tutte parti già a registro. 2 prodotti restano non estraibili perché ancora {{Unreleased}} con nomi parte non confermati (Tread Croc TQ 5-50GN: assist blade "Q" e over blade "T" senza nome ufficiale; Seize Jaguar HN: blade non ancora nominato)
- 26/07/2026 — `/update-parts`: nessuna parte nuova. Verificati a fondo i 3 nuovi Random Booster (Vol. 10, Vol. 11, BrachioWhip Select, 13 bey): tutti ricombinazioni di parti già registrate. Revid `BahamutBlitz BK1-50I` aggiornato (edit sul wiki annullato dalla community, nessun impatto sui dati)
- 16/06/2026 — docs: README/CLAUDE.md aggiornati per pipeline e confine IA/codice
- 15/06/2026 — modellato Over Blade come categoria a sé (`overBlades`) + bonifica DB parti
- 15/06/2026 — `npm run verify:wiki` contro fonte affidabile (category per-tipo X-pure) + ripristino L-Drago
