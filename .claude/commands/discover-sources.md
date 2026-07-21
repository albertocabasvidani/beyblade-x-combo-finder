---
description: Cerca e valuta nuove fonti tornei, manda la proposta via email
model: opus
effort: medium
---

Cerca NUOVE fonti di risultati di tornei Beyblade X (canali YouTube, siti/blog/newsletter, forum,
account social), **escludendo quelle già note**, le **valuta** e ti invia via **email** una proposta
motivata (corpo leggibile, niente allegati). Tu rispondi all'email in linguaggio naturale dicendo quali
approvare/scartare: il **run successivo** legge la tua risposta e applica le decisioni (promuove gli
approvati in `data/sources.json`, marca i rifiutati). Eseguito da Claude: la ricerca grezza YouTube e il
dedup li fa il codice; interpretare le pagine, giudicare le fonti, leggere il tuo feedback in linguaggio
naturale e promuovere lo fa l'IA. Solo Beyblade X.

## Prerequisiti
- `data/sources.json` (fonti attive + `manualVerification`) e `data/source-candidates.json` (staging).
- `.env` con `YOUTUBE_API_KEY` (per `discover:youtube`).
- gws CLI per leggere/inviare email: `"/c/Users/cinqu/AppData/Roaming/npm/gws.cmd"` (vedi `~/.claude/rules/gws.md`).

## Flusso

1. **Applica il feedback della proposta precedente** (se esiste). In `source-candidates.json` leggi
   `lastProposal` (`messageId`, `threadId`, `date`). Con gws cerca le **risposte** dell'utente a
   quell'email:
   `"/c/Users/cinqu/AppData/Roaming/npm/gws.cmd" gmail users messages list --user-id me --q "newer_than:10d subject:fonti candidate"`
   poi `gmail +read --id <ID>` sui messaggi con id ≠ `lastProposal.messageId` (sono il tuo feedback).
   Interpreta il testo libero (es. "approva Blade Bey X e Ben, scarta Yuki", "promuovi tutti i propose"),
   risolvendo i nomi ai `candidateId`. Per ogni candidato citato:
   - **approvato** →
     - se `type` ∈ `youtube|website|reddit|arca|spreadsheet` → aggiungilo a `sources.sources[]` di
       `data/sources.json` con `id=candidateId`, `name`, `type`, `provides`, `weight=proposedWeight`,
       `lang`, e `channelId` (YouTube — già nel candidato; se mancasse risolvilo come fa `fetch-youtube.ts`)
       oppure `urls:[url]` (website/altro);
     - se `type=social` (Instagram/Facebook/Discord/TikTok) → aggiungilo a `manualVerification[]`
       (`platform`, `handle`, `url`, `lang`, `region`): non è automatizzabile, resta zona di parcheggio;
     - segna il candidato `status:"accepted"`.
   - **rifiutato** → `status:"rejected"` e aggiungi `url`/`handle` a `knownNegatives`.
   - Se non c'è `lastProposal` o nessuna risposta → salta questo step.
   Questo è l'**unico** punto in cui il comando modifica `sources.json`/`manualVerification`, e solo per
   applicare una tua decisione esplicita: non promuove mai nulla di sua iniziativa.

2. **Carica il noto (dedup)**: leggi `data/sources.json` (`sources[].id/channelId/urls`,
   `manualVerification[].handle/url`) e `data/source-candidates.json` (`candidates[]` di QUALSIASI
   `status` + `knownNegatives`). Costruisci l'insieme di esclusione: channelId, dominio/URL, handle
   social. Un candidato che combacia con questo insieme **non si ripropone**.

3. **Cerca — una tecnica diversa per piattaforma**:
   - **YouTube** → `npm run discover:youtube` (search API, già filtra i channelId noti) → leggi
     `tmp/discover-youtube.json`. Per ogni canale giudica dai metadati (title/description/`foundVia`,
     iscritti, `lastUpload`) se è Beyblade X **competitivo che mostra risultati** (parole tipo
     tournament/大会/대회/torneo/torneio/turniej/比賽, "winning combo", "ranking", "top cut", nome lega)
     e non unboxing/teoria.
   - **Siti / blog / newsletter** → `WebSearch` con query localizzate per lingua/regione (es. *beyblade x
     tournament results / winning combinations / ranking* e gli equivalenti JP/KR/ES/PT/DE/PL/ZH/ID;
     piattaforme note.com, Substack, blog di leghe nazionali). Poi `WebFetch` sui migliori hit per
     verificare che pubblichino **piazzamenti/usage**, non solo teoria/recensioni.
   - **Forum / community testuali** (Reddit/WBO/arca-like) → `WebSearch` mirata ad altri forum o thread di
     risultati non ancora coperti.
   - **Social senza API** (Instagram/Facebook/Discord/TikTok) → `WebSearch` per handle/server per regione.
     Non si scarica il contenuto: diventano candidati `manual-verify`.
   - **MAI includere l'anno** nelle query.

4. **Valuta** ogni candidato (criteri = "se è buona"):
   - **Pubblica risultati di tornei** (piazzamenti/usage) → requisito principale. Teoria pura / tier-list
     → al massimo `skip` (o nota a bassa priorità).
   - **Freschezza**: attiva negli ultimi ~90 giorni (per YouTube usa `lastUpload`).
   - **Autorità/volume**: iscritti, frequenza di upload/post, copertura eventi.
   - **Gap di copertura**: lingua/regione non ancora coperta = alto valore; doppione di una fonte
     esistente = basso valore. Indica SEMPRE un `dedupCheck` esplicito verso la fonte più vicina.
   - Esito `recommendation`:
     - `propose` — automatizzabile (YouTube/sito/forum) e di valore;
     - `manual-verify` — social senza API, o fonte di valore ma non raccoglibile dalla pipeline;
     - `skip` — teoria, doppione, inattiva/morta.
   - Proponi `type` (`youtube|website|reddit|arca|spreadsheet|social`), `provides`
     (`combos|parts-usage`), `lang`, `region` e un `proposedWeight` indicativo. *Nota: nello scoring il
     `tier` deriva dal `type` (structured/narrative/theory), NON dal `weight` — il `weight` serve solo ai
     link UI (`src/lib/scoring.ts`). Quindi conta indovinare il `type`.*

5. **Persisti** i candidati in `data/source-candidates.json`:
   - candidati nuovi `propose`/`manual-verify` → aggiungi con `status:"proposed"`, `dateFound` e
     `lastSeen` = oggi, `candidateId` in stile `sources.json` (es. `youtube-<slug>`, `website-<slug>`);
   - candidati già presenti → aggiorna solo `lastSeen`;
   - `skip` palesi (teoria nota, doppione, morto) → aggiungi l'URL/handle a `knownNegatives`;
   - aggiorna `lastRun` = oggi.

6. **Email** — SOLO se in questo run ci sono candidati **nuovi** `propose`/`manual-verify`, oppure se è
   stato applicato del feedback (per dare conferma). Invia a `cinquequarti@gmail.com` con gws, **`--html`,
   SENZA allegati** (tutto leggibile nel corpo):

   ```
   "/c/Users/cinqu/AppData/Roaming/npm/gws.cmd" gmail +send --from "alberto@sosautomazioni.com" --to "cinquequarti@gmail.com" --html --subject "Beyblade — N nuove fonti candidate (settimana gg/mm)" --body "<corpo HTML>"
   ```
   Il mittente è l'alias send-as **`alberto@sosautomazioni.com`** (verificato sull'account gws
   `info@sosautomazioni.com`; le risposte tornano nella casella di `info@`, quindi lo step 1 le legge).

   Corpo HTML su **UNA SOLA RIGA** (niente a-capo nel `--body`: un newline lo tronca al primo
   paragrafo; l'HTML non ha bisogno di a-capo, usa i tag). Link cliccabili, niente `;` nel testo (il
   validator lo blocca):
   - se è stato applicato feedback: una riga in cima "Feedback applicato: promossi A, B; scartati C";
   - elenco ordinato per `recommendation` (prima `propose`, poi `manual-verify`), con per ogni candidato:
     **nome con link**, piattaforma/`type`, lingua/regione, **motivazione di una frase** e `dedupCheck`;
   - in coda, le **istruzioni di feedback**: *"Per approvare o scartare, rispondi a questa email in
     linguaggio naturale (es. «approva Blade Bey X e Ben, scarta Yuki» oppure «promuovi tutti i propose»).
     Il prossimo run applica le tue decisioni."*

   Dopo l'invio gws ritorna `{id, threadId}`: salvali in `source-candidates.json` come
   `lastProposal: { messageId, threadId, date, subject }` (servono allo step 1 del run successivo per
   leggere la tua risposta). Se non c'è nulla di nuovo e nessun feedback → **niente email**.

7. **Git**: `git add data/source-candidates.json data/sources.json` → commit
   `discover sources [YYYY-MM-DD]` → push. (`sources.json` cambia solo se è stato applicato feedback.)

## Note
- **La scoperta NON aggiunge fonti da sola**: l'unico modo in cui `sources.json`/`manualVerification`
  cambiano è lo step 1, applicando il tuo feedback esplicito via email. La proposta resta una decisione
  umana, ma l'applicazione è automatica.
- **Email senza allegati**: il corpo deve bastare. Il file `source-candidates.json` è solo staging/dedup
  nel repo, non si allega.
- **Idempotente**: il dedup contro `sources.json` + `source-candidates.json` + `knownNegatives` fa sì che
  rieseguire non riproponga gli stessi candidati (e non rimandi email).
- **Solo Beyblade X**: scarta fonti su Burst/Metal/altri sistemi.
- **MAI API a pagamento**: la valutazione e l'interpretazione del feedback le fa l'IA su questo
  abbonamento; l'unica API esterna è YouTube Data v3 (già usata dalla pipeline).
- Eseguito settimanalmente da `discover-sources.bat` (Task Scheduler "Beyblade Discover Sources").
