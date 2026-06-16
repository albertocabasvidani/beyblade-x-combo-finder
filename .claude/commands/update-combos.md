Aggiorna `data/combos.json` estraendo le combo competitive da tutte le fonti raccolte, riconoscendo i
nomi delle parti in qualunque lingua tramite `data/parts-master.json`. Eseguito da Claude: l'estrazione,
il match dei nomi e il dedup semantico li fa l'IA; il codice (fetcher, build) fa solo accesso e
derivazione. Solo Beyblade X.

## Prerequisiti

- `npm run collect:sources` ha già prodotto le cache grezze: `data/reddit-cache.json`,
  `data/youtube-cache.json`, `data/youtube-transcripts.json`, `data/sheets-cache.json`,
  `data/metabeys-cache.json` (eventi + leaderboard), `data/wbo-cache.json` (thread).
- `data/parts-master.json` è il dizionario nomi multilingua (names.tt/hasbro/ja/romaji + aliases).

## Flusso

1. **Carica**: `data/sources.json` (pesi, lang), `data/combos.json`, `data/parts-master.json`,
   `data/scan-history.json` e tutte le cache grezze. Inoltre leggi via WebFetch le fonti web dirette
   (type `website` con `provides:"combos"`): SBBL, note.com (kamen_a, bey_bee), okuyama3093, probladers,
   polishbladers. Per ognuna: se `scannedPages[url].contentHash` non è cambiato, salta.
2. **Riconoscimento parti (IA, multilingua)**: per ogni combo citata in una fonte, risolvi i nomi agli
   `id` del master usando `names` (tt/hasbro/ja/romaji) e `aliases` di OGNI lingua. Esempi: "Wizard Rod"
   (en) / "ウィザードロッド" (ja) / "Vara del Mago" → `wizard-rod`. Le parti TT/Hasbro coprono EN; per le
   fonti JP usa i campi ja/romaji; per ES/PT/KR/CN usa gli aliases `community` già presenti.
   - Quando trovi un nome ricorrente non mappato che denota chiaramente una parte NOTA (es. resa coreana
     di un blade esistente), aggiungilo come `aliases: {value, lang, kind:"community"}` alla voce del
     master, poi esegui `npm run build:parts`.
   - Un nome che denota una parte SCONOSCIUTA non si inventa: segnalalo per `/update-parts`.
3. **X-filter**: scarta ogni combo il cui blade/mainBlade non risolve a un id del master (toglie
   contaminazioni Burst/Metal dalle fonti multilingua).
4. **Estrazione per fonte**:
   - MetaBeys (`metabeys-cache.json`): **prima** esegui `npm run parse:metabeys` (parser
     DETERMINISTICO) che estrae placements + usage in `data/metabeys-evidence.json`. Poi gestisci a
     mano/IA solo la lista `unresolved` (combo CX a 4 segmenti, righe incomplete, typo nei nomi):
     se è un alias mancante aggiungilo al master ed esegui `build:parts`; se è una CX, aggiungila a
     `combos.json` con la sua `evidence`. NON ri-estrarre a mano ciò che il parser ha già risolto.
   - WBO (`wbo-cache.json`): se `threads.bbx-winning.blocked` è false, estrai dai post 1°/2°/3° + combo;
     registra i post processati in `scannedPosts`. Se `blocked`, segnalalo nel report.
   - YouTube: combo da titoli/descrizioni (`youtube-cache.json`) e dai transcript
     (`youtube-transcripts.json`). Reddit: body + commenti. Sheets: tabelle WBO.
5. **Combo BX/UX** = blade+ratchet+bit; **CX** = lockChip+mainBlade+assistBlade+ratchet+bit; **CX Expand**
   aggiunge `overBlade` tra lockChip e mainBlade (es. BahamutBlitz = lockChip Bahamut + overBlade Break +
   mainBlade Blitz + assistBlade Knuckle + ratchet 1-50 + bit Ignition). Il "Metal Blade" È il main blade;
   l'Over Blade (Break/Guard/Flow/Peak/Outer) è la categoria `overBlade` a sé.
6. **Dedup** per chiave id-set ordinata (`blade|ratchet|bit` per BX/UX; `lockChip|overBlade|mainBlade|assistBlade|ratchet|bit`
   per CX, con `overBlade` vuoto per le CX non-Expand): stessa chiave →
   merge (aggiorna score, sources, notes, dateUpdated); MAI duplicare. Non rimuovere combo esistenti.
   Per ogni combo popola il blocco `evidence` (NON calcolare lo score a mano):
   - `placements[]`: dai risultati torneo (MetaBeys via parser, WBO, ranking) — `placement`,
     `players`, `eventId`, `date`, `tier:"structured"`.
   - `usage[]`: da leaderboard/usage (MetaBeys via parser) — `sharePct`, `uniqueEvents`, `uniquePlayers`.
   - `mentions[]`: da fonti narrative (YouTube/Reddit/blog) e tier-list — `tier` narrative/theory.
7. **Scoring**: DETERMINISTICO, lo fa il codice. Esegui `npm run score:combos`: legge l'`evidence` di
   ogni combo e calcola `score` + `scoreBreakdown` (CAS) e i tag. Algoritmo e costanti in
   `src/lib/scoring.ts`; spec in `docs/scoring-algorithm.md`. NON scrivere score/tag a mano.
8. **Finalizza**: aggiorna `scan-history.json` (`scannedVideos`, `scannedSheets`, `scannedRedditPosts`,
   `scannedPages` con contentHash, `scannedEvents`, `scannedPosts`). `npm run score:combos` poi
   `npm run build`. Report: nuove/aggiornate combo, combo `unresolved` dal parser, nuove parti
   segnalate, alias community aggiunti, fonti `manualVerification` da controllare a mano. Git:
   `git add data/` → commit "update combos database [data]" → push.

## Note

- **MAI inventare combo**: solo combo effettivamente riportate da ≥1 fonte.
- **MAI includere l'anno nelle query** di ricerca.
- **Solo Beyblade X**: l'X-filter sul master è la garanzia finale.
- I nomi devono risolvere ESATTAMENTE a id del master. Se un nome non risolve, prima cerca tra gli
  aliases di tutte le lingue, poi valuta se è una parte nuova (→ /update-parts) o un alias da aggiungere.
- Schedulato giornalmente alle 22:00 via `analyze-combos.bat` (dopo collect-combos delle 03:30 e i
  transcript del giorno).
