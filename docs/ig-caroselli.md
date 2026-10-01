# Caroselli Instagram dai dati torneo, intervallati ai Reel

Decisioni prese il 26/09/2026 con l'utente: post generati dai dati di `combos.json`; i caroselli escono
**alle 12:00**; **un contenuto al giorno** su Instagram (Reel o carosello, mai due); i due settimanali
hanno un giorno fisso con scarto **massimo di 1 giorno**; niente bit/ratchet; niente notifiche.

## Cosa esiste già

- **Reel** (progetto `contenuti`, `C:\claude-code\Personale\contenuti`, clone sul server
  `C:\Users\server\progetti\contenuti-video`): uno ogni 2 giorni, data decisa da YouTube, TikTok e
  Instagram lo stesso giorno. Escono dal homeserver col job `contenuti-dispatcher` (07:00), che ritira
  la coda dalle GitHub Release (`tools/release_lib.py::elenca`, `quando_pubblicata`) e pubblica via API
  Graph (`tools/instagram_upload.py`: token in `.secrets/papi-nerd/instagram_token.json`, `ensure_token`
  rinnova il long-lived). Solo video: nessun supporto ai caroselli. Ospita il file su una release
  temporanea perché l'API vuole un URL pubblico (`tools/ig_publish_one.py::host_on_release`).
- **Dati**: `combos.json` rigenerato ogni notte dal job `beyblade-pipeline` (04:00) nel clone del server
  `C:\Users\server\progetti\beyblade-combos`. Mockup dei quattro formati in `tmp/ig-mockup.cjs`
  (HTML → da renderizzare in immagini).

## Tipi di post e regole di scelta

| Tipo | Contenuto | Quando |
|---|---|---|
| `top-build` (settimanale) | top 5 combo per top cut nell'ultimo mese | **lunedì** (finestra dom-mar) |
| `top-lame` (settimanale) | top 5 lame per top cut nell'ultimo mese, con quota % | **giovedì** (finestra mer-ven) |
| `build-lama-nuova` (evento) | «Le build meta per X» per una lama con primo risultato torneo da < 60 giorni che ha raggiunto **40 piazzamenti** e non ha ancora avuto il post | primo giorno libero, precedenza sugli altri eventi |
| `nuovo-ingresso` (evento) | lama in giro da > 60 giorni, fuori dalla top 5 sia sul mese sia sui 90 giorni, ≥ 15 top cut nel mese, crescita ≥ ×2 sulla media mensile dei 60 giorni prima, non pubblicata negli ultimi 90 giorni | primo giorno libero, la crescita più alta se ce n'è più d'una |
| `build-lama` (riempitivo) | «Le build meta per X» per le lame della top 10 a 90 giorni, a rotazione, stessa lama non prima di 6 settimane | ogni giorno libero senza altro |

Soglie (40 / 15 / 60 giorni / ×2 / 6 settimane) stimate sui dati di luglio-settembre 2026
(`tmp/ig-cadenza.cjs`): da rivedere dopo un mese di pubblicazioni.

**Giorno per giorno, alle 12:00 sul server:**
1. Se oggi è uscito un Reel (media Instagram con `timestamp` di oggi, via API) o ne è dovuto uno oggi
   (release in coda con `publish_at` odierno non ancora pubblicata) → non si pubblica nulla.
2. Settimanale la cui finestra include oggi e non ancora uscito questa settimana ISO:
   - oggi = T−1: si pubblica solo se domani (T) c'è un Reel in coda;
   - oggi = T: si pubblica;
   - oggi = T+1: si pubblica (T aveva un Reel non previsto).
   I Reel non escono mai due giorni di fila, quindi in ogni finestra di tre giorni c'è un giorno libero.
3. Altrimenti un evento in coda (`build-lama-nuova` prima di `nuovo-ingresso`).
4. Altrimenti il riempitivo `build-lama` successivo nella rotazione.
Un solo post al giorno; chi non esce resta in coda e ricompare il giorno libero dopo.

## Interventi

### A. Generatore (repo beyblade-combos, gira sul server nel giro notturno)

- `scripts/ig-generate.ts` (`npm run ig:generate`, deterministico, dopo `score:combos` in `/update-combos`):
  - calcola i candidati dai dati (le stesse formule di `tmp/ig-mockup.cjs`, `tmp/ig-rising.cjs`,
    `tmp/ig-top5.cjs`, spostate in `scripts/lib/ig-posts.ts` con golden test `test:ig`);
  - renderizza ogni post come HTML (template dal mockup: font Anton/Saira, foto parti da
    `public/images/parts/`) e lo fotografa con Chrome headless (`playwright-core`, viewport
    1080×1350, `deviceScaleFactor: 1`) in **JPEG** (l'API Instagram accetta solo JPEG per le immagini);
  - scrive in `out/ig/` (gitignorato, sul server): una cartella per post `<id>/` con `1.jpg…n.jpg`,
    `caption.txt` (italiano sopra, inglese sotto, hashtag in coda) e `post.json` (`id`, `type`,
    `blade`, `week` per i settimanali, `generatedAt`, `slides`), più `queue.json` con l'elenco.
  - Id stabili: `top-build-2026-W40`, `top-lame-2026-W40`, `nuovo-ingresso-heavens-ring`,
    `build-lama-nuova-hellsnether`, `build-lama-shark-scale`. Rigenerare ogni notte è idempotente: i
    numeri si aggiornano, l'id no, e il pubblicatore decide con il suo registro.
  - Cartelle più vecchie di 21 giorni cancellate a ogni giro.
- Niente PNG in git: le immagini vivono solo sul server, ospitate per il tempo del post su una release
  temporanea (come i video). Il repo committa solo il codice.

### B. Pubblicatore (repo contenuti, gira sul server)

- `tools/ig_carousel.py`: funzioni `crea_carosello(ig_id, token, image_urls, caption)` secondo l'API
  Graph (un container per immagine con `is_carousel_item=true`, poi il container `CAROUSEL` con
  `children` e `caption`, poll dello stato, `media_publish`), riusando `ensure_token`, `_graph_json`,
  `poll_status`, `publish` di `instagram_upload.py`.
- `tools/caroselli.py` (entry del job): legge `queue.json` del generatore (path in config:
  `C:\Users\server\progetti\beyblade-combos\out\ig`), applica le regole sopra, ospita le immagini del
  post scelto su una release temporanea (`host_on_release` generalizzato ai file immagine, o funzione
  gemella), pubblica, cancella la release, scrive il registro `.secrets/papi-nerd/caroselli.json`
  (`id`, `type`, `blade`, `date`, `media_id`, `week`). Se l'API fallisce: registro intatto, il post
  riprova il giorno libero dopo, avviso sul canale che `contenuti` già usa per i propri errori.
- «Reel oggi?»: `release_lib.elenca()` + `quando_pubblicata` per la coda; media Instagram di oggi via
  `GET /me/media?fields=media_type,timestamp` (stessa API, stesso token).
- Job nel manifest del server `jobs.HOMESERVER.json`: `contenuti-caroselli`, `due: 12:00`, daily,
  `run` = python `tools\caroselli.py`, `cwd` del clone `contenuti-video`, timeout 20 min. Voce nel
  manifest, mai `schtasks`.

### C. Dashboard e documentazione

- `tools/dashboard.py` di `contenuti`: una riga per i caroselli (ultimo uscito, prossimo previsto),
  così il calendario Reel + caroselli si legge in un posto.
- CLAUDE.md dei due repo (chi genera, chi pubblica, orari, regole, registro); `projects/` di
  beyblade-combos (nuova area o voce in `web-frontend`?) e di `contenuti`.

## Verifica

1. `test:ig`: candidati e regole di scelta su un `combos.json` fisso (mese con 3 candidati, settimana
   con Reel sul giorno T, settimana senza eventi → riempitivo, stessa lama non ripetuta).
2. `ig:generate` sul server: `queue.json` con i post attesi, immagini 1080×1350 JPEG aperte a occhio.
3. Prova di pubblicazione su Instagram con un post vero (l'utente decide quale), poi cancellazione
   della release verificata su GitHub.
4. Una settimana di giri alle 12:00: registro con un post al giorno nei giorni senza Reel, settimanali
   entro ±1 giorno da lunedì e giovedì.

## Fuori scope

Bit/ratchet, xtreme/infinity, torneo della settimana, notifiche di freschezza.

## Linea CX

Le CX contano come le BX in ogni post (dal 01/10/2026). La loro esclusione era una scelta di Claude per
semplificare il primo giro, finita per errore fra i confini decisi: l'utente non l'aveva mai chiesta.
Per una CX la «lama» è la Main Blade: un post `build-lama` può quindi essere su una Main Blade (oggi
`build-lama-blast`). La slide di una combo CX mostra le parti in una griglia 3×2 (lock chip, main blade,
assist blade, over blade se c'è, ratchet, bit).

## Stessi numeri della home

I conteggi stanno in `src/lib/top-cut.ts` e usano le finestre della home (30 e 90 giorni da
`windowsRef` di `combos.json`, `windowCutoff` di `src/lib/scoring.ts`): il carosello `top-build` è la
home con `30D · Top cuts · Combos`, `top-lame` è `30D · Top cuts · Blades`, `build-lama-X` è `90D ·
Top cuts` con le combo della lama X. Anche lo spareggio è lo stesso (top cut, poi vittorie, poi nome
o id). Verificato il 01/10/2026: prime 20 combo e prime 20 lame nello stesso ordine in home e nei
candidati. `ig:generate` stampa a ogni giro la parità con `windows["30"]` (attese 0 combo diverse).
Una pagina `/top-cut/` a parte è stata pubblicata e tolta lo stesso giorno: l'utente vuole queste
classifiche nella home.
