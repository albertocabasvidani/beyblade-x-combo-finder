---
description: Giudica a blocchi rilevanza e lingua dei video YouTube in cache
model: sonnet
effort: medium
---

Giudica la rilevanza dei video YouTube raccolti (`data/youtube-cache.json`) **a blocchi**, in modo
idempotente, decidendo per ognuno se riguarda combo/deck/meta/tornei **competitivi Beyblade X** e in
quale lingua è parlato. Serve a far scaricare i transcript solo dei video utili, nella lingua giusta.
Eseguito da Claude: il batching e il merge li fa il codice (`scripts/youtube-judge-batch.ts`), il
giudizio (rilevanza + lingua) lo fa l'IA leggendo titolo + descrizione + tag, anche non in inglese.

## Confine IA / codice
Il pre-filtro deterministico (`scripts/lib/youtube-relevance.ts`, eseguito da `fetch:youtube`) ha già
scartato il rumore evidente (franchise estranei, video senza alcun segnale Beyblade): quei video hanno
`prefilter: "drop"` e NON arrivano qui. Tu giudichi solo i `prefilter: "pass"` non ancora valutati.

## Prerequisiti
- `npm run fetch:youtube` ha popolato `data/youtube-cache.json` con `tags`, `description` completa,
  `defaultAudioLanguage` e `prefilter` su ogni video.

## Flusso (LOOP finché "Rimanenti" = 0)

1. `npm run youtube:judge -- next --size 50` → scrive `tmp/youtube-judge-batch.json` (blocco di video
   `prefilter:"pass"` non ancora giudicati) e stampa **quanti rimangono**.
2. Se il blocco servito è **0** video, esci dal loop e vai a "Fine".
3. **Leggi** `tmp/youtube-judge-batch.json`. Per ogni video (`videoId`, `title`, `description`, `tags`,
   `sourceLang`, `defaultAudioLanguage`) decidi:
   - **`relevant`** (bool): `true` se il video tratta combo/deck/meta/tier/risultati di **tornei
     competitivi di Beyblade X**. `false` per: unboxing/apertura buste, gameplay casual, recensioni
     prodotto non competitive, news/leak, vlog, **Beyblade Burst** (generazione vecchia, non X), o
     altro franchise. Nel dubbio tra "competitivo X" e "casual", guarda i tag (`meta`, `tournament`,
     `deck`, `combo`, `tier`, `competitive`) e la descrizione.
   - **`lang`** (ISO 639-1, es. `en`/`it`/`ko`/`zh`/`pt`/`es`/`ja`/`id`): lingua **reale del parlato**.
     Inferiscila dalla lingua del titolo/descrizione, con `defaultAudioLanguage` e `sourceLang` come
     conferma. Attenzione: i tag sono spesso in inglese anche su video non-EN — non farti ingannare.
   - **`reason`** (≤1 frase): perché rilevante o no.
   Scrivi tutti i verdetti del blocco in `tmp/youtube-judge-extracted.json`:
   `{ "videos": [ { "videoId": "...", "relevant": true, "lang": "ko", "reason": "..." }, ... ] }`.
4. `npm run youtube:judge -- done` → fonde i verdetti in `data/youtube-cache.json`.
5. Torna al punto 1.

## Fine
- Report: video giudicati, di cui rilevanti / scartati, distribuzione lingue.
- Segnala i canali con quasi tutti i video `relevant:false` (candidati alla rimozione da
  `data/sources.json`).
- **Niente commit qui**: lo fa la pipeline a valle (i transcript e `/update-combos` arrivano dopo).

## Note
- **Idempotente**: lo stato `relevant` vive nella cache; ri-eseguire non ri-giudica i video già
  decisi e riprende da dove era rimasto.
- Consuma **tutti** i pending nello stesso run (loop fino a 0): la cache è la worklist e un
  `fetch:youtube` successivo potrebbe aggiungere/spostare video.
- **MAI inventare**: giudichi solo i video del blocco. Un `videoId` assente in cache viene ignorato dal merge.
