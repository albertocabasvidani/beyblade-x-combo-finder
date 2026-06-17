# Competitive Authority Score (CAS) — proposta algoritmo combo

Obiettivo: ordinare le combo per **autorevolezza competitiva** — quanto sono provate dai
risultati dei tornei (vittorie, finali), pesando le fonti e l'indipendenza dei dati, non solo
"quante volte sono citate".

## 1. Punto di partenza e problema

Scoring attuale (`/update-combos` step 7), calcolato a mano dall'IA:

```
score = sourceReliability*0.4 + frequency*0.35 + recency*0.25
```

- `sourceReliability` = media pesata dei `weight` delle fonti.
- `frequency` = 0–10 da **quante fonti** citano la combo.
- `recency` = dalla data del contenuto più recente.

I dati nelle cache contengono molto più segnale di quanto questa formula usi, **e lo scarta**:

- **MetaBeys eventi** (`metabeys-cache.json`): piazzamento esplicito (`1st — … / 2nd — … / 3rd …`),
  podio (`CHAMPION/SECOND/THIRD`), **numero giocatori** (`33 players`, `71 players`, `12 players`),
  dimensione top-cut (`Top Cut 8`), deck score (S/A/B/C/D), data.
- **MetaBeys leaderboard**: per combo `Appearances`, `Share %`, **`Unique Events`**, **`Unique
  Players`** su finestra 30g. Es. `Wizard Rod 1-60 Hexa → 731 app., 14%, 228 eventi, 335 player`;
  rank ~50 `Phoenix Wing 3-60 Point → 19 app., 0.35%, 17 eventi`.
- **WBO**: 1°/2°/3° posto con combo esatte per evento.

`data/combos.json` oggi salva in `sources[]` solo `name/url/weight/date`: **piazzamento, dimensione
evento e indipendenza vengono persi al momento dell'estrazione**. Senza quei campi nessuna formula
può pesare "vincitrice vs partecipante" o "major vs locale".

## 2. Principio architetturale

Coerente col confine IA/codice del progetto, ma spostando **più** lavoro sul codice deterministico
dove le fonti lo permettono:

- **Estrazione strutturata → codice (deterministico).** MetaBeys eventi e leaderboard hanno formato
  tabellare costante (`33 players`, `1st — Nome`, `Blade / Ratchet / Bit`, colonne
  `Appearances/Share/Unique Events/Unique Players`). Si parsano con parser dedicato (regex/split),
  senza IA — incluse le **CX a 4 segmenti** (`core / assist / ratchet / bit`) via `cx-resolve.ts`
  (condiviso con WBO). Stesso discorso per le tabelle Sheets.
- **WBO → codice (deterministico).** Il thread WBO è eterogeneo (token incollati, marcatori di
  piazzamento misti, quote/ads), ma `parse:wbo` lo gestisce interamente a codice
  (`scripts/lib/wbo-parse.ts`): segmentazione via regex + risoluzione parti/sigle ufficiali/id. Risolve
  **sia BX sia CX** (le CX via `scripts/lib/cx-resolve.ts`, order-agnostic + Western); **nessun cambio
  alla formula CAS** — le CX entrano nel CAS con lo stesso schema placement delle BX (id-set
  `lockChip-[overBlade]-mainBlade-assistBlade-ratchet-bit`). Il residuo va nel ledger
  `wbo-unresolved.json` (idempotente); i refusi li recupera il subagent typo di `/update-combos`.
- **Estrazione narrativa → IA.** Solo fonti in prosa (transcript YouTube, commenti Reddit, blog
  JP/ES/PT/…) e il **match nomi parti multilingua** sugli id del master restano all'IA.
- **Calcolo score → codice (deterministico).** Da `evidence` a `score`, riproducibile, tunabile,
  testabile. Lo scoring esce dallo step 7 (stima inline dell'IA) e va in `scripts/score-combos.ts`.
- **Merge multi-fonte → codice.** `score:combos` unisce i placement di `metabeys-evidence.json` e
  `wbo-evidence.json`, deduplicandoli per evento fisico (data + posizione + nome evento normalizzato):
  MetaBeys indicizza anche eventi WBO, quindi senza dedup lo stesso torneo conterebbe due volte.
  Limite: nomi evento testualmente diversi tra le fonti non si uniscono; WBO pesa come `structured`
  (1.0), non 0.95.

L'`evidence` viene **persistito** in `combos.json`: serve sia al ricalcolo deterministico dello
score, sia a mostrare la prova in UI (sezione 7).

## 3. Modello dati (prerequisito)

Aggiungere a ogni combo un blocco `evidence`. Sostituisce di fatto `scoreBreakdown` come fonte di
verità; `sources[]` resta per i link mostrati in UI.

```jsonc
"evidence": {
  "placements": [                 // un record per (evento, piazzamento) da fonti torneo
    { "source": "metabeys", "tier": "structured",
      "eventId": "1781464572675", "eventName": "Untouchables Locals",
      "date": "2026-06-13", "placement": 1, "topCutSize": 4, "players": 33,
      "deckScore": "B", "lang": "en" }
  ],
  "usage": [                      // da fonti leaderboard/usage
    { "source": "metabeys-leaderboard", "date": "2026-06-15", "window": "30d",
      "appearances": 731, "sharePct": 14.0, "uniqueEvents": 228, "uniquePlayers": 335 }
  ],
  "mentions": [                   // fonti "soft": youtube/reddit/tier-list (opinione, non risultato)
    { "source": "youtube-beymac", "date": "2026-06-01", "kind": "recommendation", "lang": "en" }
  ]
}
```

Distinzione netta: `placements`/`usage` = **risultati**; `mentions` = **opinioni**. Le opinioni
contano poco e non possono spacciarsi per prova torneo (vedi Pilastro 3).

## 4. Algoritmo: CAS

Tre pilastri normalizzati 0–1, combinati e scalati a 0–10. Tutte le costanti in un blocco unico,
tarabili dopo aver visto la distribuzione reale.

### Mappa saturante

Usata ovunque per dare rendimenti decrescenti e limite superiore:

```
sat(x, K) = x / (x + K)        // monotona, 0→0, ∞→1
```

Vantaggio: una combo con 40 vittorie non vale il doppio di una con 20, ma resta sopra; e il numero
di apparizioni è già "dentro" il valore → la numerosità del campione è gestita qui, senza doppie
penalità.

### Pilastro 1 — Tournament Performance (peso 0.55) — il cuore

Somma dei punti-piazzamento su tutti gli eventi, ognuno pesato da posizione, dimensione evento,
affidabilità fonte e decadimento temporale.

```
placementWeight(p):  1°=1.00  2°=0.65  3°=0.45  4°=0.30  5°–8°=0.20  altro top-cut=0.12
eventWeight = clamp( sqrt(players / 16), 0.5, 3 )      // 16 player =1.0; 64 ≈2.0; major pesa di più
sourceTier  = weight della fonte (sources.json): strutturate 0.95–1.0
decay(days) = 0.5 ^ (daysAgo / HALF_LIFE)             // HALF_LIFE = 75g (turnover meta X)

P_raw       = Σ_eventi [ placementWeight × eventWeight × sourceTier × decay ]
performance = sat(P_raw, K_perf)                       // K_perf ≈ 6
```

### Pilastro 2 — Meta Presence / Usage (peso 0.30)

Dalla leaderboard usage. Premia **ampiezza** (unique events, indipendenza) e **intensità** (share).

```
u = log1p(uniqueEvents)        // ampiezza, decrescente
s = sharePct                   // intensità (%)
presence = sat(s * u, K_pres)  // K_pres ≈ 3
```

Decadimento sullo snapshot: se l'usage è più vecchio di N giorni, applicare `decay` anche qui.
Esempi con K_pres=3:
- Wizard Rod (s=14, u=log1p(228)=5.43 → s·u≈76) → `presence ≈ 0.96`
- Phoenix Wing 3-60 Point (s=0.35, u=log1p(17)=2.89 → s·u≈1.0) → `presence ≈ 0.25`

### Pilastro 3 — Source Corroboration (peso 0.15)

Ampiezza di **fonti indipendenti distinte** che la confermano, pesate per tier, con rendimenti
decrescenti. Qui vivono YouTube/Reddit/tier-list. Distinte per **fonte**, non per menzione:
10 video di un canale = 1 fonte.

```
C_raw = Σ_fontiDistinte ( tierWeight ) + langDiversityBonus
corroboration = sat(C_raw, K_corr)         // K_corr = 2.0
```

`langDiversityBonus`: piccolo bonus (es. +0.2 per lingua oltre la prima) — una combo confermata in
EN+JA+ES è meta globale, non locale.

> **Peso per TIPOLOGIA, non per fonte.** Il codice pesa per `tier` (`structured` 1.0, `narrative`
> 0.6, `theory` 0.3 — `CONST.TIER_WEIGHT`), **non** per il `weight` fine di ogni fonte in
> `sources.json`: quel campo serve solo ai link mostrati in UI. Conseguenza voluta: WBO è scorato
> come `structured` = **1.0** (non 0.95). Se in futuro servisse il peso per-fonte, va aggiunto un
> campo numerico all'evidence e moltiplicato in `scoring.ts`.

### Combinazione

```
base = 0.55*performance + 0.30*presence + 0.15*corroboration
score = round( 10 * base, 1 )
```

### Confidence (ATTIVO — shrinkage low-sample)

Shrinkage esplicito verso il basso per l'evidenza da campione unico:

```
n = max( n° eventi distinti in placements, uniqueEvents della usage )
confidence = n / (n + K_conf)              // K_conf = 4
score = round( 10 * base * (0.5 + 0.5*confidence), 1 )
```

**Attivo in produzione** (`score-combos.ts` chiama `scoreCombo(ev, { ref, useConfidence: true })`):
la condizione documentata si è verificata — ~117/148 combo con placement poggiano su **un solo
evento**, e la sola saturazione non li distingueva da combo provate su più eventi. Il multiplier
(0.6 per n=1, ~0.83 per n=8) li declassa proporzionalmente. `n` resta esposto come badge in UI
("18 eventi, 4 vittorie").

## 5. Tag derivati

- `meta` se score ≥ 8.5
- `top-tier` se score ≥ 7.0
- `tournament-proven` se ≥1 `placement` da fonte strutturata (metabeys/wbo/sbbl/ranking nazionale)
- `theory-only` se **nessun** placement/usage, solo `mentions` → flag di onestà, cap in display
- `rising` (implementato) se la performance grezza dei placement nella finestra recente
  (≤ `RISING_WINDOW_DAYS` = 30g) supera quella storica per un fattore `RISING_RATIO` (1.15) → momentum

> Soglie `meta`/`top-tier` **ricalibrate sulla distribuzione reale** (il combo dominante tocca ~8.7,
> non 10): a 9.0/8.0 nessuna combo sarebbe `meta`. I valori canonici sono quelli del codice
> (`scoring.ts` / golden test), questo doc li rispecchia.

## 6. Perché è meglio

1. **Pesa il piazzamento** (vincitrici/finali) — requisito #1, oggi ignorato del tutto.
2. **Pesa la dimensione evento** — vittoria a 71 player > vittoria a 12.
3. **Indipendenza-aware** — uniqueEvents/uniquePlayers + conteggio fonti distinte impediscono che
   un singolo YouTuber prolifico o un solo grande evento dominino.
4. **Tier fonti netti** — i DB torneo (`structured`) dominano, le opinioni (`narrative`/`theory`)
   sono confinate al pilastro corroboration e capate. Il peso è per tipologia di fonte, non per
   singola fonte (vedi nota al Pilastro 3).
5. **Decadimento temporale** — riflette il turnover rapido del meta X: "autorevole **ora**".
6. **Deterministico e tunabile** — costanti nominate in un punto, A/B-testabili, con golden test.

## 7. UX ricerca ("capire quanto sono autorevoli")

Lo score da solo non comunica fiducia. Esporre l'evidenza accanto al numero:

- badge autorevolezza: `Tournament-proven · 18 eventi · 4 vittorie · 14% meta share`
- barre breakdown: Performance / Presence / Corroboration
- provenienza: "usata dal Gold medalist World Championship 2025"
- filtri ricerca: solo `tournament-proven`, finestra 30/60/90g, n° minimo eventi, lingua/regione.

## 8. Costanti (default iniziali)

```
HALF_LIFE = 75 giorni
CUTOFF = 12 mesi (confine duro, scripts/lib/freshness.ts)
pesi pilastri = 0.55 / 0.30 / 0.15
K_perf = 6 ; K_pres = 3 ; K_corr = 2.0 ; K_conf = 4 (ATTIVO)
placementWeight = {1:1.0, 2:0.65, 3:0.45, 4:0.30, 5-8:0.20, topcut:0.12}
eventWeight = clamp(sqrt(players/16), 0.5, 3)
langDiversityBonus = +0.2 per lingua oltre la prima
tag: meta ≥ 8.5 ; top-tier ≥ 7.0
rising: RISING_WINDOW_DAYS = 30 ; RISING_RATIO = 1.15
```

Costanti tarate sulla distribuzione reale dopo il primo run. Fonte canonica: `src/lib/scoring.ts`
(`CONST`), coperta dai golden test `scripts/test-scoring.ts`.

### Cutoff temporale (12 mesi) vs decadimento

Il `decay` (emivita 75g) è una rampa continua: un evento di 12 mesi pesa già ~0.034 (`0.5^(365/75)`),
contributo trascurabile. Il **cutoff a 12 mesi** è invece un confine **duro** che taglia la coda di
rumore a monte dello score, in tre punti coerenti (unica costante in `scripts/lib/freshness.ts`):
fetch (stop della paginazione storica), parse (scarto dei placement oltre cutoff) e score (filtro
dell'evidenza unita). Le combo che restano senza alcuna evidenza fresca le archivia `prune:combos` in
`combos-archive.json` (deterministico, dry-run + guardrail). Override per test/tuning:
`COMBO_CUTOFF_MONTHS`.

**Robustezza date**: `daysBetween` è NaN-safe — una data non valida è trattata come "oggi" (0 giorni),
così un singolo dato sporco non azzera lo score dell'intera combo (regressione vista col backfill WBO,
dove date fuori-range producevano `NaN`). I parser emettono solo date di calendario reali (validazione
in `parse:wbo`/`parse:metabeys`).

## 9. Migrazione

Le combo esistenti non hanno `evidence`. Le cache grezze sono conservate → al prossimo
`/update-combos` l'IA ripopola `evidence` ri-leggendo metabeys/wbo/leaderboard, e
`scripts/score-combos.ts` ricalcola tutti gli score in modo deterministico. Nessun dato perso.
