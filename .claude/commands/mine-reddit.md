Mina i post Reddit raccolti (`data/reddit-cache.json`) **a blocchi**, in modo idempotente, per
estrarre le combo competitive senza skimmare. Risolve il limite per cui la cache è troppo grande
(migliaia di righe) per un singolo Read: `/update-combos` da solo legge le prime ~2000 righe e
generalizza. Qui un loop legge tutto, un blocco alla volta, e segna ogni post in `scan-history` così
i run successivi non lo rivedono.

Funziona uguale per un **backfill storico** (~900 post → molti blocchi) e per la **marcia normale**
(pochi post nuovi al giorno → 1 blocco). Eseguito da Claude: l'estrazione e il match nomi li fa l'IA;
il batching e la marcatura li fa il codice (`scripts/reddit-batch.ts`).

## Prerequisiti
- `data/reddit-cache.json` popolato (`npm run scrape:reddit`, o `REDDIT_BACKFILL=1` per lo storico).
- `data/parts-master.json` (dizionario nomi multilingua) e `data/combos.json`.

## Flusso (LOOP finché "Rimanenti" = 0)

1. `npm run reddit:batch -- next --size 60` → scrive `tmp/reddit-mining-batch.json` (blocco di post non
   ancora scansionati) e stampa **quanti rimangono**.
2. Se il blocco servito è **0** post, esci dal loop e vai a "Fine".
3. **Leggi** `tmp/reddit-mining-batch.json`. Per ogni post (`title`, `body`, `comments`):
   - Riconosci le parti sul master (`names` tt/hasbro/ja/romaji + `aliases` di ogni lingua), multilingua.
   - **X-filter**: scarta combo il cui blade/mainBlade non risolve a un id del master.
   - Aggiungi una combo SOLO se effettivamente riportata. Classifica l'evidenza come in `/update-combos`:
     - **risultato di torneo reale** (es. "won my locals with…", "top cut", piazzamento, nome evento) →
       `placements[]` (o `mentions` con `kind:"tournament-report"` se manca il dettaglio evento);
     - **raccomandazione/discussione** competitiva → `mentions[]` (tier narrative).
     - Discussione casual senza combo competitiva → niente (ma il post resta marcato scansionato).
   - **Dedup** per chiave id-set (come `/update-combos`): stessa chiave → merge dell'`evidence`, MAI
     duplicare. **MAI inventare** combo: solo quelle realmente nei post.
4. `npm run reddit:batch -- done` → marca scansionati gli id del blocco corrente in `scan-history`.
5. Torna al punto 1.

## Fine
- `npm run score:combos` → ricalcola gli score CAS e i tag dall'`evidence` aggiornata.
- `npm run build`.
- Report: post processati, combo nuove/aggiornate, parti nuove segnalate (→ `/update-parts`).
- Git: `git add data/` → commit `mine reddit combos [YYYY-MM-DD]` → push.

## Note
- **Idempotente**: `scan-history.scannedRedditPosts` è la verità su cosa è già fatto; ri-eseguire non
  duplica e riprende da dove era rimasto (anche se interrotto a metà: i blocchi non marcati con `done`
  vengono riserviti).
- **Solo Beyblade X** (X-filter sul master è la garanzia finale).
- Un nome che denota una parte SCONOSCIUTA non si inventa: segnalalo per `/update-parts`. Un alias
  mancante di parte NOTA si aggiunge al master + `npm run build:parts`.
- La cache normale tiene i 150 post più recenti (KEEP_TOP); un backfill (`REDDIT_BACKFILL=1`) tiene
  tutto: minare il backfill **prima** che un run normale poti la cache.
