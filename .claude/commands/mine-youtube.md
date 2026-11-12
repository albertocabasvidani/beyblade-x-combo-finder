---
description: Estrae le combo competitive da un blocco di transcript YouTube
model: sonnet
effort: medium
---

Leggi **un blocco** di transcript YouTube e di' quali combo competitive Beyblade X contengono. Un
blocco per invocazione: il ciclo sui blocchi lo fa `daily-pipeline.bat`, non tu. La scelta dei
video, la costruzione dell'evidenza, il merge in `combos.json` e la marcatura dei video letti li fa
il codice (`scripts/youtube-mine-batch.ts`). Tu leggi e riconosci le parti.

## Passi

1. `npm run youtube:mine -- next` → scrive `tmp/youtube-mining-batch.json` (i video del blocco) e
   `tmp/youtube-mining-parts.json` (dizionario delle parti). Se stampa «0 video», scrivi «niente da
   leggere» e fermati qui.
2. Leggi `tmp/youtube-mining-parts.json`: per ogni categoria (`blades`, `lockChips`, `mainBlades`,
   `assistBlades`, `overBlades`, `ratchets`, `bits`) un elenco di `{ id, nomi }`. `nomi` contiene i
   nomi Takara Tomy e Hasbro, il giapponese, il romaji, gli alias delle altre lingue e la sigla dei
   bit. Una parte si indica sempre col suo `id`.
3. Leggi `tmp/youtube-mining-batch.json` per intero. Se il Read lo tronca, continua con `offset`
   finché non hai letto tutti i video: ogni video del blocco va letto prima di rispondere.
4. Per ogni video (`title`, `description`, `transcript`, `lang`) elenca le combo **complete** che il
   video mostra in uso in un torneo o raccomanda per il gioco competitivo:
   - BX/UX: `blade` + `ratchet` + `bit`. Se la voce del blade ha `ratchetIntegrato: true`, la combo
     è `blade` + `bit` e `ratchet` resta `null`.
   - CX: `lockChip` + `mainBlade` + `assistBlade` + `ratchet` + `bit`, più `overBlade` se c'è.
   - `kind`: `"tournament-report"` se il video riporta la combo come usata in un torneo (deck di un
     giocatore, finale, top cut), `"recommendation"` se la consiglia o la analizza.
   - Una combo entra solo se **tutte** le sue parti si leggono nel video e risolvono a un `id` del
     dizionario. I transcript automatici storpiano i nomi («wizard rod» → «wizard road»): risolvi
     quando la parte è riconoscibile senza dubbio, altrimenti lascia fuori la combo. Non completare
     una combo con parti che il video non dice e non inventarne.
   - Un video senza combo complete (solo battaglie commentate, nomi dei blade senza ratchet e bit)
     ha `combos: []`. È un esito normale.
5. Scrivi `tmp/youtube-extracted.json` con questo schema. `batchId` è quello del blocco. In `videos`
   ci va **ogni** video del blocco, anche quelli senza combo:

   ```json
   {
     "batchId": "<batchId del blocco>",
     "videos": [
       { "videoId": "abc123def45", "combos": [
         { "blade": "wizard-rod", "ratchet": "1-60", "bit": "hexa", "kind": "tournament-report" },
         { "lockChip": "bahamut", "overBlade": "break", "mainBlade": "blitz", "assistBlade": "knuckle",
           "ratchet": "1-50", "bit": "ignition", "kind": "recommendation" }
       ] },
       { "videoId": "zyx987wvu65", "combos": [] }
     ]
   }
   ```
6. `npm run youtube:mine -- done` → controlla la risposta, fonde le combo in `data/combos.json`,
   marca i video come letti. Se risponde «RIFIUTATO», correggi `tmp/youtube-extracted.json` secondo
   il messaggio e rilancia `done`. Le righe «SKIP» del merge sono combo scartate dal registro: non
   vanno corrette a mano.
7. Riporta in tre righe: video letti, video con combo, combo nuove e aggiornate (dall'output di
   `done`), e i nomi di parte ricorrenti che non hai trovato nel dizionario.

## Cosa non fare

- Non lanciare `score:combos`, `build`, `git`: lo score e il commit li fa `/update-combos`, che gira
  dopo questo step.
- Non modificare `data/youtube-mined.json`, `data/combos.json` né il dizionario a mano.
- Non leggere `data/youtube-transcripts.json` né `data/youtube-cache.json`: il blocco contiene già
  tutto.
