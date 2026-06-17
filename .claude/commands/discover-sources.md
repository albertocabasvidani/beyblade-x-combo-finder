Cerca NUOVE fonti di risultati di tornei Beyblade X (canali YouTube, siti/blog/newsletter, forum,
account social), **escludendo quelle già note**, le **valuta** e ti invia via **email** una proposta
motivata. NON aggiunge nulla a `data/sources.json`: i candidati restano in staging
(`data/source-candidates.json`) finché tu non li promuovi a mano. Eseguito da Claude: la ricerca grezza
YouTube e il dedup li fa il codice; interpretare le pagine, giudicare se una fonte pubblica risultati
veri, valutare gap e doppioni lo fa l'IA. Solo Beyblade X.

## Prerequisiti
- `data/sources.json` (fonti attive + `manualVerification`) e `data/source-candidates.json` (staging).
- `.env` con `YOUTUBE_API_KEY` (per `discover:youtube`).
- gws CLI per l'email: `"/c/Users/cinqu/AppData/Roaming/npm/gws.cmd"` (vedi `~/.claude/rules/gws.md`).

## Flusso

1. **Carica il noto (dedup)**: leggi `data/sources.json` (`sources[].id/channelId/urls`,
   `manualVerification[].handle/url`) e `data/source-candidates.json` (`candidates[]` di QUALSIASI
   `status` + `knownNegatives`). Costruisci l'insieme di esclusione: channelId, dominio/URL, handle
   social. Un candidato che combacia con questo insieme **non si ripropone**.

2. **Cerca — una tecnica diversa per piattaforma**:
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

3. **Valuta** ogni candidato (criteri = "se è buona"):
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

4. **Persisti** in `data/source-candidates.json` (MAI toccare `sources.json`):
   - candidati nuovi `propose`/`manual-verify` → aggiungi con `status:"proposed"`, `dateFound` e
     `lastSeen` = oggi, `candidateId` in stile `sources.json` (es. `youtube-<slug>`, `website-<slug>`);
   - candidati già presenti → aggiorna solo `lastSeen`;
   - `skip` palesi (teoria nota, doppione, morto) → aggiungi l'URL/handle a `knownNegatives` per non
     riproporli;
   - aggiorna `lastRun` = oggi.

5. **Email** — SOLO se in questo run ci sono candidati **nuovi** `propose`/`manual-verify`:
   invia a `cinquequarti@gmail.com` con gws (riga di comando, MAI `gws` nudo):

   ```
   "/c/Users/cinqu/AppData/Roaming/npm/gws.cmd" gmail +send --to "cinquequarti@gmail.com" --subject "Beyblade — N nuove fonti candidate (settimana gg/mm)" --body "..."
   ```

   Corpo: elenco ordinato per `recommendation` (prima `propose`, poi `manual-verify`) e valore, con per
   ogni candidato: nome, piattaforma/`type`, lingua/regione, link cliccabile, **motivazione di una frase**
   e `dedupCheck`. In coda: "I candidati sono in `data/source-candidates.json`; promuovili a mano in
   `data/sources.json` quelli che approvi." Se non c'è nulla di nuovo → **niente email** (scrivilo solo
   nel report a schermo).

6. **Git**: `git add data/source-candidates.json` → commit `discover sources [YYYY-MM-DD]` → push.
   (Persiste il dedup tra i run, come gli altri comandi della pipeline.)

## Note
- **MAI aggiungere fonti a `sources.json`**: la promozione è una decisione umana. Questo comando si ferma
  allo staging + email.
- **Idempotente**: il dedup contro `sources.json` + `source-candidates.json` + `knownNegatives` fa sì che
  rieseguire non riproponga gli stessi candidati (e non rimandi email).
- **Solo Beyblade X**: scarta fonti su Burst/Metal/altri sistemi.
- **MAI API a pagamento**: la valutazione la fa l'IA su questo abbonamento; l'unica API esterna è YouTube
  Data v3 (già usata dalla pipeline).
- Eseguito settimanalmente da `discover-sources.bat` (Task Scheduler "Beyblade Discover Sources").
