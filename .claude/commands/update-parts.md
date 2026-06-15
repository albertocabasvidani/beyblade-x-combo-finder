Aggiornamento giornaliero del database parti Beyblade X da Beyblade Fandom Wiki. Rileva SOLO le
modifiche (diff per revid), aggiorna `data/parts-master.json`, rigenera `data/parts.json` con
`npm run build:parts`. Eseguito da Claude (la lettura/interpretazione delle pagine e il match dei nomi
li fa l'IA; il codice fa solo derivazione e validazione). Solo Beyblade X.

## Accesso

API MediaWiki (la `/wiki/` dà 403): `https://beyblade.fandom.com/api.php?action=parse&page=TITLE&format=json&prop=wikitext` (spazi→`_`).
Revisioni in batch: `action=query&titles=A|B|...&prop=revisions&rvprop=ids|timestamp` (fino a 50 titoli/chiamata).

## Flusso (evita lavoro inutile)

1. **Carica stato**: `data/parts-master.json` (ogni voce ha `source.page` e `source.revid`),
   `data/scan-history.json` (`scannedPages[url].revid`).
2. **Nuovi prodotti**: leggi le 2 liste
   (`List_of_Beyblade_X_products_(Takara_Tomy)` sezioni 1-4, `..._(Hasbro)`), estrai i link
   `[[Pagina]]`, confronta con i `source.page` già nel master → titoli nuovi = worklist iniziale.
3. **Pagine cambiate**: per tutte le pagine note (i `source.page` del master), una/poche chiamate batch
   `prop=revisions&rvprop=ids` → confronta `revid` attuale con quello salvato. Diverso → aggiungi alla
   worklist; uguale → **skip** (nessun fetch del wikitext). Se una pagina non ha `revid` salvato
   (prima esecuzione dopo l'import), trattala come da verificare una volta, poi salva il revid.
4. **Estrai solo la worklist**: per ogni pagina cambiata/nuova applica le regole di `/scrape-parts-master`
   (BX/UX 1:1 dalla pagina prodotto; CX dalle pagine parte `Main Blade - X`/`Lock Chip - X`/`Assist Blade - X`,
   e per i CX Expand anche `Over Blade - X`; `tt` = nome parte mai codice; `{{Ruby}}`→base; `AKA (Hasbro)`→hasbro
   senza tag; type blade = Type prodotto, type bit = Type pagina Bit; Expand Blade → mainBlade=MetalBlade +
   categoria `overBlade`; X-filter su `Series`).
   Scrivi i record flat in `tmp/parts-extract-update.json` (stesso schema dei batch).
5. **Merge**: `npx tsx scripts/merge-master.ts` (idempotente: arricchisce le voci, aggiunge le nuove,
   pulisce i tag, aggiorna i conflitti). Poi aggiorna `source.revid`/`lastVerified` delle voci toccate
   e i `scannedPages[url].revid` in `scan-history.json`.
6. **Derivazione**: `npm run build:parts` (guardrail combos deve restare verde; il ⚠️ delle parti
   products mancanti deve restare a 0). Poi `npm run build`.
7. **Verifica delta**: esegui `/verify-parts-master` sulle voci nuove/cambiate; rivedi i conflitti
   rilevanti in `data/parts-master-conflicts.json`.
8. **Report + Git**: elenca parti nuove/cambiate, conflitti; `git add data/ && commit "update parts database [data]" && push`.
9. **Worklist vuota** → "Nessuna nuova parte" e stop prima di qualsiasi fetch del wikitext.

## Note

- **Solo Beyblade X**: scarta ogni pagina con `Series ≠ "Beyblade X"`.
- **Mai inventare**: nome non derivabile → `null`; parte non confermata → `status:"unverified"`.
- I nomi non-EN (KR/CN/ES/PT) NON sono su Fandom: li aggiunge `/update-combos` come `aliases{kind:"community"}`.
- Schedulato giornalmente alle 03:00 via `update-parts.bat` (Task Scheduler).
