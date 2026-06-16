# Audit avversariale del combo-finder — 16/06/2026

Analisi avversariale del sistema di raccolta e scoring delle combo: l'approccio attuale dà
risposte soddisfacenti a un giocatore Beyblade X? Mancano fonti? L'algoritmo è debole?

**Metodo**: review multi-agente (mappatura del sistema → 6 critici indipendenti con ricerca web
sul meta competitivo reale di giugno 2026 → verifica scettica di ogni rilievo contro codice e
fonti). 54 rilievi grezzi → 47 confermati/parziali, 7 refutati. Le severità qui sotto sono quelle
**dopo** la verifica (molti "critical/high" iniziali sono stati declassati perché veri come
meccanismo ma innocui sui dati reali).

> **Stato implementazione (16/06/2026)** — piano `aggiungi-la-distinzione-dello-…`:
> **Fatto**: ① stadio (estratto da WBO, filtro+badge), ⑤ freschezza+trend (`lastPlacementDate`,
> `usageTrend`, tag `rising`), filtro linea BX/UX/CX + ricerca blade-centrica, e tutta la §3
> (useConfidence attivo, eventName WBO corretto + dedup, placement Reddit preservati, guardrail
> anti-allucinazione, doc allineata, peso fonte chiarito). Fonti: `note.com/kamen_a` corretto,
> arca.live (KR) e BBX Weekly (cross-check, fuori dal CAS) aggiunti; BBX.gg escluso (doppioni).
> **Escluso per scelta**: ② deck builder 3-on-3 e ④ modellazione legalità/ban — non implementati
> (BX/UX/CX restano un ranking unico filtrabile; legalità non modellata).

---

## Verdetto

- **Giocatore casual** ("una combo forte con i pezzi che ho"): risposta buona. Scoring
  deterministico, evidenza torneo reale, il top del ranking (Wizard Rod 1‑60 Hexa, Shark Scale)
  coincide col meta reale verificato.
- **Giocatore competitivo** (preparazione torneo): oggi risponde alla **domanda sbagliata** su un
  **meta parziale**. Le debolezze vere sono di **modello di dominio** e **copertura fonti**, non di
  formula matematica.

---

## 1. Debolezze che cambiano la risposta al giocatore (confermate, alta priorità)

### ① Formati e stadi mescolati in un unico ranking — **critica**
MetaBeys e WBO girano quasi solo su **Xtreme Stadium** (overseas); i tornei ufficiali giapponesi
usano l'**Infinity Stadium**; dal 2026 la WBO mantiene leaderboard separate per i due stadi. Sono
ambienti competitivi diversi (KO, stamina, movimento cambiano col piatto). Lo scoring fonde tutto
in un numero, senza campo `stadium`/`format` → rifonde dati che la fonte primaria teneva
deliberatamente separati. Lo conferma la fonte stessa del progetto (`note.com/kamen_a`).
**Fix**: aggiungere `stadium` (extreme/infinity) e `format` (wbo-x/hasbro/jp-official) a ogni
placement; permettere filtro/segmentazione in UI e scoring.

### ② Si gioca a deck 3‑on‑3, non a combo singole — **alta** (feature mancante, non dato errato)
Il competitivo regional/national è deck di 3 beyblade **senza parti ripetute** (eccetto i lock
chip). Il sito ordina combo isolate per score globale (`src/lib/search-engine.ts`); top‑1 e top‑2
spesso condividono lo stesso bit → seguendo il ranking si compone un deck illegale o sbilanciato.
Manca l'entità Deck e i ruoli Lead/Counter/Anchor.
**Fix**: layer "deck builder" sopra il ranking esistente, con vincolo di unicità parti e copertura
di ruoli/archetipi; documentare che lo score è "autorevolezza della combo isolata".

### ③ Scena giapponese ufficiale quasi assente — **alta**
Le uniche fonti torneo tier‑1 (MetaBeys 1.0, WBO 0.95) sono overseas in inglese. Il circuito
ufficiale TT (X‑TREME CUP, BEYBLADE X GP, World Championship 15.000+ partecipanti) entra solo come
*mention* narrativa a peso basso, mai come placement strutturato. Mitigato dalla convergenza
globale del meta, ma archetipi/formati JP‑specifici restano sotto‑pesati.

### ④ Legalità / ban list / Hall of Fame non modellate — **alta**
Il modello ha solo `line: 'bx' | 'cx'`, nessun `legalIn`/`banned`/`era`. Conseguenza verificata:
la combo **#1 attuale (Wizard Rod 1‑60 Hexa) contiene una parte oggi *ristretta* nel formato
WBO X**, e il bit Metal Needle è bandito — ma viene comunque mostrata senza avviso. Le combo di
linee diverse (BX, UX, CX) sono **interlacciate in un unico ranking senza distinzione di formato**;
il tipo `ComboLine` non contemplava `'ux'` pur essendo già nei dati.
**Fix**: `legalIn`/`restrictedFrom`/`restrictedUntil` su parti/combo; badge "WBO‑banned".
*(Escluso dall'implementazione su scelta dell'utente: la legalità resta non modellata. Fatto solo il
contorno: tipo `ComboLine` esteso a `'ux'` e filtro linea opzionale — il ranking resta unico.)*

### ⑤ La freschezza non è mai visibile — **alta**
Il decay (half‑life 75g) è cotto nello score ma la card non mostra nessuna data
(`src/components/search/combo-card.tsx`): due combo a 7.5 (una in ascesa, una di 4 mesi fa)
appaiono identiche.
**Fix**: mostrare data dell'ultimo piazzamento/`dateUpdated` o badge Fresh/Stale; implementare i
filtri finestra 30/60/90g già previsti nel doc scoring §7.

---

## 2. Fonti mancanti (confermato)

| Gap | Severità | Nota |
|---|---|---|
| Scena ufficiale JP (TT/Bey Stadium, X‑TREME CUP, GP) | alta | nessuna fonte torneo strutturata JP |
| Split Xtreme/Infinity Stadium | critica | mescolati senza distinzione (vedi ①) |
| MetaBeys monocultura: unica fonte del pilastro Usage (0.30) | media | single point of failure: un parse errato altera il pilastro in silenzio |
| WBO: solo thread "Winning Combinations" | media | ignorati ban list, format rules, thread standings/meta |
| BBX.gg e BBX Weekly (aggregatori attivi 2026) | media | romperebbero la monocultura + più freschezza |
| World Championship 2025 come mention soft, non placement | media | l'evento più autorevole non pesa nel Pilastro Performance |
| `note.com/kamen_a` mis‑configurato come blog 0.7 | media | pubblica prize‑score WBO aggregati; URL al profilo radice, non ai report |
| Discord competitivi, Facebook PH/MY, arca.live KR | bassa | solo in `manualVerification`, mai raccolti (limite tecnico) |
| Fonti minori stagionali senza alert di liveness | bassa | una regione coperta da una sola fonte che si ferma sparisce dalla corroboration senza segnale |

---

## 3. L'algoritmo è debole? Quasi sempre no

Tutti i rilievi "critical/high" sulla **matematica del CAS** sono stati **declassati a low** dopo
aver misurato i 457 combo reali: saturazione, clamp di `eventWeight`, half‑life, `langDiversityBonus`
gonfiabile sono veri come meccanismo ma **non si attivano sul dataset attuale** (max 13 vittorie per
combo, nessun evento >115 player, mentions cappate a 0.15 di peso). I docs li dichiarano già "da
ricalibrare". **La formula non è il problema.**

Restano debolezze reali di **algoritmo/pipeline** di media severità:

- **`useConfidence` è codice morto** mentre **117 combo su 148 poggiano su un solo evento**: lo
  shrinkage low‑sample esiste (`src/lib/scoring.ts:123`) ma `scripts/score-combos.ts` non lo attiva
  mai. La condizione che i docs indicano per accenderlo è già soddisfatta. — *media*
- **Dedup cross‑fonte per "nome evento" fallisce quasi sempre**: il parser WBO estrae lo *username
  del poster del forum* ("Shawn514", "anon7437") come nome evento (`scripts/lib/wbo-parse.ts:202`)
  → non matcherà mai i nomi puliti di MetaBeys. Impatto bounded (~0.18 sul top combo per
  saturazione), ma bug sistematico. — *media*
- **`score:combos` scarta i placement Reddit** quando la combo è anche su MetaBeys/WBO
  (`scripts/score-combos.ts:86`): perdita latente (overlap oggi 0). — *media*
- **Nessun guardrail anti‑allucinazione IA**: l'unico controllo su `tmp/reddit-extracted.json` è
  referenziale (le parti devono esistere). Una combo plausibile inventata entra nel DB; il tier
  narrative limita il danno, ma manca verifica del testo sorgente. — *media*
- **WBO pesa 1.0 invece di 0.95**, i pesi fini di `data/sources.json` ridotti a 3 bucket. — *bassa*
- **Drift doc↔codice**: soglie tag (doc 9.0/8.0 vs codice 8.5/7.0), `K_corr` (doc 2.5 vs codice
  2.0). Allineare la **doc** al codice testato. — *bassa/media*
- **Tag `rising` documentato e "gestito" ma mai implementato** (`deriveTags` non lo emette): i
  momentum‑pick non emergono mai. O lo si implementa, o lo si rimuove da `MANAGED_TAGS`/doc. — *bassa*

---

## 4. Freschezza silenziosa (media, insidiosa)

- **Fetch falliti in silenzio**: se MetaBeys/WBO falliscono (Cloudflare, captcha non risolto), gli
  script escono con codice 0 e `collect-sources` li conta come successo. Nessun alert di staleness.
- **L'usage "non invecchia mai"**: se il fetch leaderboard fallisce,
  `scripts/fetch-metabeys.ts:80‑81` preserva la vecchia leaderboard **ma timbra `lastFetched` a
  oggi** → l'usage stantio risulta `decay≈1.0` (fresco) per sempre. Combinato col punto sopra: il
  meta appare perennemente fresco mentre è morto.
  **Fix**: non timbrare `lastFetched` quando la leaderboard non è stata effettivamente rifetchata
  (campo `leaderboardFetchedAt` separato); far fallire i fetch a vuoto; tag `stale-data` se il
  placement/usage più recente supera una soglia.

---

## 5. Gap UX (meno utile, non sbagliato)

- **Archetipo non filtrabile**: `type` esiste su ogni combo ed è già un badge, ma niente
  filtro/ranking per archetipo. Chi ha già un'Attack e cerca la Stamina mancante non può isolarla.
- **Spin direction non modellata**: nessun campo `spinDirection`; si perde l'asse strategico più
  caratteristico (left‑spin/spin‑steal, es. Cobalt Dragoon).
- **Bit matchup-dependent appiattito**: Ball vs Hexa si scambiano in base alla minaccia avversaria,
  ma ogni variante è un record indipendente con score fisso; manca lo swap‑advice.
- **Manca "cosa mi manca per la top combo"**: nessun ordinamento per parti mancanti, nessun "ti
  manca 1 pezzo" (esiste solo il toggle booleano "Buildable" e una sezione "Suggeriti" per parte).
- **Ricerca parti debole**: `part-search.tsx` cerca solo sul nome TT, non su `nameWestern` (nome
  Hasbro sulla scatola), alias o `shortName` del bit (H/FB/LR).
- **Budget assente**: un link Amazon per ogni parte mancante, senza prezzo né raggruppamento per set.
- **Score breakdown solo in tooltip** (`title`): invisibile su mobile/touch.
- **Matchup/regione non esposti**: lo score globale appiattisce la forza relativa agli avversari e
  alla regione; limite non documentato in CLAUDE.md/known issues.

---

## 6. Cosa NON è un problema (rilievi refutati — per non rincorrere fantasmi)

1. Il filtro "parti possedute" **funziona** (toggle "Buildable"); il presunto bug di ordine
   argomenti era un fantasma da incrocio vecchio‑commit/nuova‑firma.
2. Il dedup id‑set **non fonde** combo diverse: 457 id, 0 collisioni, 0 collisioni BX↔CX.
3. I **theory‑only non si confondono** coi tournament‑proven: cappati a ~1.5 (osservato max 0.90),
   banda grigia "VIABLE", sprofondano oltre il rank 133, privi della riga‑evidenza torneo.
4. Il backfill Reddit **non espone score instabili**: commit atomico unico, stati intermedi mai
   pushati né deployati.
5. Il parser leaderboard MetaBeys **regge i nomi multi‑token** (splitta su tab/newline, non spazi).
6. Nessun "tab di linea" che finge di filtrare e fallisce: semplicemente non esiste (scelta di
   design: ranking unico BX+CX).
7. Il Google Sheet "tier list" è in realtà **dato torneo derivato** dal WBO Winners Thread, e il suo
   peso 0.8 non entra comunque nello scoring.

---

## 7. Quick win a basso costo

1. Attivare `useConfidence: true` in `scripts/score-combos.ts` (condizione documentata soddisfatta:
   117/148 combo a singolo evento) + estendere i golden test.
2. Allineare la **doc** al codice: soglie tag 8.5/7.0, `K_corr` 2.0; rimuovere/implementare `rising`.
3. Far fallire (exit ≠ 0) i fetch MetaBeys/WBO a vuoto e separare `leaderboardFetchedAt` da
   `lastFetched` per riparare il decay dell'usage.
4. Nel ramo `hasFresh` di `score-combos.ts`, preservare i placement narrative (Reddit) accanto a
   quelli ri‑derivati da MetaBeys+WBO.
5. Far cercare `part-search` su `name + nameWestern + aliases + shortName`.
6. Esporre la data dell'ultimo piazzamento sulla card.

## 8. Interventi strutturali (alto valore, più costosi)

1. Campo `stadium`/`format` su ogni placement + segmentazione del ranking.
2. Layer **deck builder** 3‑on‑3 con vincolo unicità parti e ruoli.
3. Fonti torneo JP strutturate + almeno una seconda fonte usage (BBX Weekly/BBX.gg).
4. Modello di legalità (`legalIn`/`banned`/`era`) e badge relativi.
5. Filtro/ranking per archetipo; campo `spinDirection`.

---

**Da verificare a parte** (emerso dalla ricerca, non rilievo di sistema): il bronzo CX del World
Championship 2025 risulta modellato come "Valkyrie Blast **Wall**" mentre la fonte dice "Blast
**Wheel**" — assist blade distinti in `parts.json` (1407 vs 1413). Probabile errore di estrazione.
