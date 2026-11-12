---
description: Estrae le combo competitive dalle pagine web cambiate dall'ultima lettura
model: sonnet
effort: medium
---

Leggi **un blocco** di pagine web e di' quali combo competitive Beyblade X contengono. Le pagine le
ha già scaricate `fetch-web.ts`: non aprire nessun sito, niente WebFetch. La scelta delle pagine, la
costruzione dell'evidenza, il merge in `combos.json` e la registrazione delle letture li fa il
codice (`scripts/web-mine-batch.ts`). Tu leggi e riconosci le parti.

## Passi

1. `npm run web:mine -- next` → scrive `tmp/web-mining-batch.json` (le pagine del blocco) e
   `tmp/web-mining-parts.json` (dizionario delle parti). Se stampa «0 pagine», scrivi «niente da
   leggere» e fermati qui.
2. Leggi `tmp/web-mining-parts.json`: per ogni categoria (`blades`, `lockChips`, `mainBlades`,
   `assistBlades`, `overBlades`, `ratchets`, `bits`) un elenco di `{ id, nomi }`. `nomi` contiene i
   nomi Takara Tomy e Hasbro, il giapponese, il romaji, gli alias delle altre lingue e la sigla dei
   bit. Una parte si indica sempre col suo `id`.
3. Leggi `tmp/web-mining-batch.json` per intero. Se il Read lo tronca, continua con `offset` finché
   non hai letto tutte le pagine. Ogni pagina ha `url`, `sourceId`, `lang`, `title`, `text`.
4. Per ogni pagina elenca le combo **complete** che riporta:
   - BX/UX: `blade` + `ratchet` + `bit`. Se la voce del blade ha `ratchetIntegrato: true`, la combo
     è `blade` + `bit` e `ratchet` resta `null`.
   - CX: `lockChip` + `mainBlade` + `assistBlade` + `ratchet` + `bit`, più `overBlade` se c'è.
   - `kind`: `"tournament-report"` se la pagina la riporta come usata in un torneo (deck di un
     podio, deck vincitore, classifica di combo giocate in lega), `"recommendation"` se la consiglia
     (articoli sui deck e sulle combo più forti).
   - `date`: `"aaaa-mm-gg"` del torneo, solo quando la pagina la scrive accanto alla combo. Se non
     c'è, ometti il campo.
   - Le sigle dei bit attaccate al ratchet («9-60FB», «1-60LR») si risolvono con `nomi`.
   - Una combo entra solo se **tutte** le sue parti si leggono nella pagina e risolvono a un `id`
     del dizionario. Non completare una combo con parti che la pagina non dice e non inventarne.
   - Nelle pagine-classifica (SBBL) contano le combo della classifica, non quelle elencate sotto
     ogni voce come avversarie («FUERTE CONTRA», «DÉBIL CONTRA»).
   - Una pagina senza combo complete ha `combos: []`. È un esito normale.
5. Scrivi `tmp/web-extracted.json`. `batchId` è quello del blocco. In `pages` ci va **ogni** pagina
   del blocco, con l'`url` identico a quello servito:

   ```json
   {
     "batchId": "<batchId del blocco>",
     "pages": [
       { "url": "https://esempio.org/vincitori", "combos": [
         { "blade": "wizard-rod", "ratchet": "1-60", "bit": "hexa", "kind": "tournament-report", "date": "2026-10-25" },
         { "blade": "shark-scale", "ratchet": "3-60", "bit": "low-rush", "kind": "recommendation" }
       ] },
       { "url": "https://esempio.org/altra", "combos": [] }
     ]
   }
   ```
6. `npm run web:mine -- done` → controlla la risposta, fonde le combo in `data/combos.json`,
   registra le letture. Se risponde «RIFIUTATO», correggi `tmp/web-extracted.json` secondo il
   messaggio e rilancia `done`. Le righe «SKIP» del merge sono combo scartate dal registro: non
   vanno corrette a mano.
7. Riporta in tre righe: pagine lette, combo nuove e aggiornate (dall'output di `done`), e i nomi di
   parte ricorrenti che non hai trovato nel dizionario.

## Cosa non fare

- Non lanciare `score:combos`, `build`, `git`: lo score e il commit li fa `/update-combos`, che gira
  dopo questo step.
- Non modificare `data/web-mined.json`, `data/web-cache.json`, `data/combos.json` né il dizionario
  a mano.
