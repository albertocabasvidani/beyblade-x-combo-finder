---
description: Aggiorna combos.json dalle cache fonti (estrazione, match multilingua, dedup)
model: sonnet
effort: high
---

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
     DETERMINISTICO) che estrae placements + usage in `data/metabeys-evidence.json`, risolvendo **BX
     (3 segmenti) e CX (4 segmenti** `core / assist / ratchet / bit`, via `cx-resolve.ts`). Poi gestisci
     a mano/IA solo la lista `unresolved`, ormai ridotta (typo, righe incomplete, core senza lockChip):
     se è un alias mancante aggiungilo al master ed esegui `build:parts`. **NON aggiungere a mano le CX**
     che il parser già risolve né ri-estrarre ciò che ha già risolto.
   - WBO (`wbo-cache.json`): esegui `npm run parse:wbo` (parser DETERMINISTICO: segmentazione del
     thread + risoluzione **BX e CX**) che scrive i placements in `data/wbo-evidence.json` e aggiorna
     il **ledger** `data/wbo-unresolved.json` (idempotente). Il parser ora risolve da solo la grande
     maggioranza delle CX (~87%): **NON aggiungere a mano le CX** — lo fa `score:combos`. L'IA lavora
     SOLO sul **delta nuovo** del ledger, su questo abbonamento (mai API a pagamento):
     - **refusi** (`category: typo`/`blade-unresolved`/`bit-unresolved`): esegui `npm run typo:candidates`
       (dump in `tmp/typo-candidates.json`), poi — come **subagent economico** (Haiku) — proponi per
       ogni riga la versione corretta usando la lista nomi del registro, scrivila in
       `tmp/typo-corrected.json` (`[{line, correctedLine}]`); un **secondo subagent giudice** conferma i
       match dubbi. Esegui `npm run typo:apply` (gate: la riga corretta DEVE risolvere → merge in
       `wbo-corrections.json`) e ri-esegui `npm run parse:wbo`: i refusi spariscono dal ledger.
     - parte realmente NUOVA non nel master: aggiungila a `parts-master.json` + `npm run build:parts`.
     - resto (`missing-data` "?", `cx-ambiguous`, varianti ambigue): lascialo nel ledger, segnalalo nel
       report. Non forzare combo inventate.
     Se `threads.bbx-winning.blocked` è true o `raw` è vuoto, il parser scrive evidence vuota (no-op).
     NON ri-estrarre a mano ciò che il parser ha già risolto.
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
7. **Scoring**: DETERMINISTICO, lo fa il codice. Esegui `npm run score:combos`: unisce
   `metabeys-evidence.json` + `wbo-evidence.json` (placements deduplicati per evento fisico:
   data+posizione+nome evento) con l'`evidence` di ogni combo, e calcola `score` + `scoreBreakdown`
   (CAS) e i tag. Algoritmo e costanti in `src/lib/scoring.ts`; spec in `docs/scoring-algorithm.md`.
   NON scrivere score/tag a mano.
8. **Finalizza**: aggiorna `scan-history.json` (`scannedVideos`, `scannedSheets`, `scannedRedditPosts`,
   `scannedPages` con contentHash, `scannedEvents`, `scannedPosts`). `npm run score:combos`, poi
   `npm run prune:combos -- --apply` (archivia in `data/combos-archive.json` le combo rimaste senza
   evidenza fresca entro il cutoff di 12 mesi; senza `--apply` è un dry-run da ispezionare prima — il
   guardrail aborta se le orfane superano il 60% o se l'evidenza torneo è a zero), poi `npm run build`.
   Report: nuove/aggiornate combo, combo archiviate, **delta nuovo del ledger** `wbo-unresolved.json`
   (refusi corretti, residuo lasciato), nuove parti segnalate, alias community aggiunti, fonti
   `manualVerification` da controllare a mano. Git:
   `git add data/` → commit "update combos database [data]" → push.

## Note

- **MAI inventare combo**: solo combo effettivamente riportate da ≥1 fonte.
- **MAI includere l'anno nelle query** di ricerca.
- **Solo Beyblade X**: l'X-filter sul master è la garanzia finale.
- I nomi devono risolvere ESATTAMENTE a id del master. Se un nome non risolve, prima cerca tra gli
  aliases di tutte le lingue, poi valuta se è una parte nuova (→ /update-parts) o un alias da aggiungere.
- Eseguito ogni giorno alle 08:00 come ultimo passo di `daily-pipeline.bat` (dopo `/update-parts` e
  `collect:sources`); i transcript YouTube arrivano via `fetch-transcripts.bat` (ogni 5 min) e sono
  raccolti dai run successivi.
