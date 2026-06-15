Verifica di qualità di `data/parts-master.json` dopo un import (`/scrape-parts-master`) o un update
(`/update-parts`). Controllo strutturale + spot-check sulle fonti. Non corregge: produce un report e
aggiorna `data/parts-master-conflicts.json`.

## Controlli strutturali (senza rete) — regole validate

Carica `data/parts-master.json`, `data/combos.json`, `data/products.json` ed elenca i problemi.
Una voce difettosa = **un solo issue per il difetto primario** (non sommare difetti derivati).

1. `duplicate_id`: id duplicati nella stessa categoria.
2. `missing_tt`: `names.tt` mancante o vuoto. (Se presente, non segnalare altri difetti di nome per quella voce.)
3. `hasbro_equals_tt`: `names.hasbro` valorizzato e uguale a `names.tt` (dovrebbe essere null).
4. `missing_ja`: `names.ja` vuoto **solo** per categorie con nome proprio (`blades`, `lockChips`,
   `mainBlades`, `assistBlades`). **NON** applicare a `ratchets`/`bits` (codici/termini tecnici condivisi).
5. `dangling_combo`: ogni id parte referenziato in `combos.json` deve esistere nel master nella categoria
   giusta. (Questo è bloccante: le combo sono i dati mostrati.)
6. `missing_in_products`: parti referenziate da `products.json` ma assenti dal master (warning: lavoro
   residuo per l'import, non bloccante).

## Controlli di copertura

- Ogni voce con `status:"verified"` deve avere `source.url` e (per le parti con nome proprio) `names.ja`.
- Round-trip id: ogni id presente nel vecchio `data/parts.json` deve esistere nel master, oppure essere
  elencato nei conflitti come orfano intenzionale. **Mai** perdere un id usato dalle combo.

## Completezza contro la fonte affidabile — `npm run verify:wiki`

Esegui `npm run verify:wiki`: confronta il master con le **category per-tipo del Fandom Wiki** (fonte
X-pura e completa — i termini Lock Chip/Main Blade/Metal Blade/Assist Blade/Over Blade/Ratchet/Bit sono
esclusivi di X; la `Category:Blades` è mista X+Burst quindi i blade vengono filtrati su `Category:Beyblade X`).
Riporta MANCANTI (parti X sul wiki assenti dal master → aggiungerle via `/update-parts`) ed EXTRA (parti
nel master non a catalogo wiki: RatchetBit, varianti community, dati podio — verificare caso per caso,
**non** rimuovere se usate da `combos.json`). Obiettivo: **0 mancanti**. È il riferimento affidabile
contro cui validare il registro parti, e di conseguenza le estrazioni combo dai vari siti (che risolvono
i nomi sul master).

## Spot-check sulle fonti (IA, a campione)

Scegli ~5 parti `verified` a caso (mix BX e CX) e rileggi la loro `source.url` via API MediaWiki
(`action=parse&prop=wikitext`). Conferma che `names.tt`, `names.hasbro`, `names.ja` corrispondano
all'infobox. Per le parti CX, ricorda: il nome Hasbro va confrontato con la **pagina parte dedicata**
(`Main Blade - X` ecc.), non col nome prodotto. Segnala ogni discrepanza come `source_mismatch`.

## Output

1. Report markdown: conteggi per categoria, totale issue per tipo, elenco issue, esito spot-check.
2. Aggiorna `data/parts-master-conflicts.json` con gli issue che richiedono decisione umana
   (`duplicate_id`, `source_mismatch`, orfani).
3. Se ci sono `dangling_combo` → segnala come BLOCCANTE (build:parts fallirebbe).

Non modificare `parts-master.json` in questo comando: la verifica è di sola lettura (a parte il file
conflitti). Le correzioni le fa l'umano o un successivo `/scrape-parts-master`/`/update-parts`.
