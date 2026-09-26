---
name: instagram-caroselli
status: active
updated: 26/09/2026
health: yellow
next-step: "Prima pubblicazione vera con --forza (scelta dell'utente), poi una settimana di giri alle 12:00"
blocked-by: null
current-plan: docs/ig-caroselli.md
main-doc: docs/ig-caroselli.md
---

# Caroselli Instagram dai dati torneo

## Scope

Post Instagram (caroselli di immagini) generati ogni notte da `combos.json`: top 5 build e top 5 lame
settimanali, «nuovo ingresso nel meta», «le build meta per X». Il generatore sta in questo repo
(`scripts/ig-generate.ts`, `scripts/lib/ig-posts.ts`, `scripts/lib/ig-render.ts`); la scelta del post del
giorno e la pubblicazione stanno nel progetto `contenuti` (`tools/caroselli.py`, job `contenuti-caroselli`
alle 12:00 sul server), intervallate ai Reel di papi.nerd: un contenuto al giorno.

## Backlog

<!-- Idee, feature, task non avviati. Formato: `- gg/mm/aaaa — testo` -->
- 26/09/2026 — Rivedere le soglie (40 piazzamenti per la lama nuova, 15 top cut e ×2 per il nuovo ingresso, 6 settimane fra due riempitivi sulla stessa lama, 60 giorni per «lama nuova») dopo un mese di pubblicazioni: sono stime su luglio-settembre 2026 (`tmp/ig-cadenza.cjs`)
- 26/09/2026 — Riga «caroselli» nella dashboard di `contenuti` (`tools/dashboard.py`): ultimo uscito e prossimo previsto, così Reel e caroselli si leggono in un posto
- 26/09/2026 — Etichetta in copertina per distinguere una lama uscita da poco da un ritorno («uscito il …» contro «in giro da mesi»): la data della prima evidenza torneo c'è già in `data.firstSeen`
- 26/09/2026 — Fuori scope per scelta dell'utente: bit/ratchet, CX, xtreme/infinity, torneo della settimana

## Known issues

<!-- Bug noti, problemi aperti, debiti tecnici. Formato: `- gg/mm/aaaa — testo` -->
- 26/09/2026 — Font da Google Fonts a ogni render: senza rete escono i font di ripiego senza errore (attesa massima 10 s per slide). Se le slide sul server uscissero con un font sbagliato, la via è mettere Anton/Saira in `public/fonts/` e caricarli come data URI
- 26/09/2026 — `nuovo-ingresso` per una lama uscita da poco è in parte l'effetto dell'uscita stessa: il filtro «prima evidenza da ≥ 60 giorni» lo tiene fuori, ma una lama uscita 61 giorni fa con pochi podi iniziali può entrare come «crescita». Da guardare nei primi casi reali

## In progress

<!-- Lavori in corso. Se collegati a un piano in plans/, linkalo. -->
- 26/09/2026 — **Messa in produzione** (disegno: `docs/ig-caroselli.md`). Fatto: generatore con golden test (`test:ig`, 28 controlli), 13 post generati in locale dai dati del 26/09 e guardati (top 5 build/lame, nuovo ingresso Heavens Ring, 10 riempitivi), pubblicatore con test delle regole (`tools/test_caroselli.py`, 10 casi), job nel manifest del server. Resta: `git pull` sui tre cloni del server (beyblade-combos, contenuti-video, task-dispatcher), primo `ig:generate` sul server, `caroselli.py --dry`, prima pubblicazione vera con `--forza` sul post scelto dall'utente, poi una settimana di giri

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 26/09/2026 — **Disegno e prime prove.** Analisi dei post sul meta di gengischad (caroselli statici con una build per slide: 1.400-2.360 like contro ~110 dei reel, didascalie in inglese), quattro formati mockuppati in `tmp/ig-mockup.cjs` con i dati veri, tre correzioni dell'utente (numero di tornei al posto dei nomi delle fonti, niente score CAS, piè di slide leggibile, classifica ordinata per top cut). Decisioni: caroselli alle 12:00, un contenuto al giorno, settimanali con scarto massimo di un giorno, niente bit/ratchet. Frequenza dei «nuovo ingresso» misurata settimana per settimana su tre mesi: gli stessi candidati restano sopra soglia per 4-9 settimane, quindi serve un registro dei pubblicati, non un post per settimana; le lame che sfondano arrivano a 40 piazzamenti in 19-35 giorni dal primo risultato (Dran Strike 19, Bullet Griffon 25, Glory Valkyrie 35)
