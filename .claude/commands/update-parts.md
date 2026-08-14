---
description: Aggiornamento giornaliero del database parti Beyblade X (diff per revid)
model: sonnet
effort: medium
---

Aggiornamento giornaliero del database parti Beyblade X dalla Beyblade Fandom Wiki. **La scoperta
di cosa e' cambiato non e' compito tuo**: la fa `scripts/scan-wiki-updates.ts`, che ti consegna una
worklist e il wikitext gia' scaricato. Tu leggi quel wikitext ed estrai le parti. Solo Beyblade X.

Un giorno normale la worklist e' vuota e questo comando finisce in meno di due minuti, senza
subagent e senza una sola richiesta di rete fatta da te.

## Perche' e' fatto cosi'

Prima la scoperta era affidata all'IA: confrontava tutti i link `[[...]]` delle due pagine-lista
contro i `source.page` del master. Ma le pagine Hasbro sono `#REDIRECT` a quelle Takara Tomy, e
Dual Pack, Multipack, Random Booster e accessori non sono `source.page` di nessuna parte: cosi'
risultavano "nuovi" **ogni singolo giorno**. Il 14/08/2026 sono diventati 149 falsi positivi, 9
subagent in parallelo, 21 minuti e il 20% della finestra token — per zero parti nuove. Adesso il
diff e' codice deterministico e lo stato sta in `data/wiki-scan.json`.

## Flusso

### 1. Scoprire cosa e' cambiato

```
npm run scan:wiki
```

Se stampa `WORKLIST VUOTA`: non c'e' niente da fare. Committa `data/wiki-scan.json` **solo se e'
cambiato** (`git diff --quiet -- data/wiki-scan.json`), con messaggio `wiki scan: nessuna novita'
[data]`, poi **fermati qui**. Non lanciare merge, build o verifiche.

Altrimenti leggi `tmp/parts-worklist.json`. Per ogni voce in `pages`:
- `file` — il wikitext gia' scaricato, **inchiodato al revid del diff**. Leggilo da li'.
  **Non usare WebFetch** (in questo ambiente risponde 402) e non rifare fetch con `curl`.
- `kind` — `product`, `part`, `set`, `randombooster`, `multipack`.
- `reason` — `new` o `changed`; `via` dice se viene dalle liste o dal `==Contents==` di un'altra pagina.

Le voci in `autoRefresh` (accessori, videogiochi, pagine meta) e in `missing` **non le tocchi**:
le registra lo script al punto 7.

### 2. Estrarre

Applica le regole di `/scrape-parts-master` (BX/UX 1:1 dalla pagina prodotto; CX dalle pagine parte
`Main Blade - X` / `Lock Chip - X` / `Assist Blade - X`, e per i CX Expand anche `Over Blade - X`;
`tt` = nome della parte, mai un codice prodotto; `{{Ruby}}`→base; `AKA (Hasbro)`→hasbro senza tag;
type blade = Type del prodotto, type bit = Type della pagina Bit; Expand Blade → mainBlade=MetalBlade
+ categoria `overBlade`).

**Filtro sulla serie — attenzione, e' la trappola che ha gia' morso.** `Series` sul wiki indica la
**stagione dell'anime**, non la linea di giocattoli: i valori legittimi sono `Beyblade X`,
`Beyblade X (Season 1)`, `(Season 2)`, `(Season 3)`… Tieni tutto cio' che **comincia** per
`Beyblade X`. Scarta solo le altre generazioni (`Beyblade Burst`, `Metal Fight`, l'originale).
Applicare il confronto alla lettera butterebbe via il 39% delle pagine, prodotti CX compresi.

Per `kind` `multipack`, `set` e `randombooster` la pagina contiene **piu' bey**: estraili tutti.

Scrivi i record flat in **`tmp/parts-extract-batch-daily.json`** (il nome deve iniziare per
`parts-extract-batch-`, altrimenti `merge-master.ts` non lo legge e il merge riesce a vuoto):

```
{ category, tt, hasbro?, ja?, romaji?, short?, type?, line?, fromProduct, fromUrl,
  productCodes?: string[], firstSet? }
```
- `category` ∈ `blade|lockChip|mainBlade|assistBlade|overBlade|ratchet|bit` (singolare).
- **`fromProduct` e `fromUrl` sono obbligatori**: senza, la voce nuova resta senza `source` e la
  pagina non risultera' piu' collegata alla parte.
- Per i **ratchet** `tt` e' la forma a codice (`3-60`), non un nome: diventa l'id cosi' com'e'.

Scrivi anche `tmp/parts-worklist-results.json` con quello che hai capito delle pagine — serve allo
script per registrare la classificazione giusta al posto di quella euristica:
```json
{ "pages": [ { "title": "...", "kind": "multipack", "notes": "solo recolor", "extractedParts": 0 } ],
  "extraPages": [ { "title": "Iron Man 4-80B", "kind": "product", "notes": "membro multipack" } ] }
```

**Subagent solo sopra le 15 pagine**: sotto, fai da te. Sopra, dividi in lotti da ~15 con **al
massimo 4 in parallelo**, e ogni lotto scrive il suo `tmp/parts-extract-batch-daily-N.json`.

Se non hai estratto nessun record, salta al punto 7 (niente merge: riscriverebbe il master solo
per cambiare il campo `version`).

### 3. Consolidare

```
npx tsx scripts/resolve-new-parts.ts
npx tsx scripts/merge-master.ts
```

Il primo passo impedisce i doppioni da **rinomino**: nei set in collaborazione Hasbro ribattezza
blade gia' esistenti (la pagina `Spinosaurus 3-85A` dichiara `BladeX = Spinosaurus`, ma
`Blade - Spinosaurus` e' un redirect a `Blade - Roar Tyranno`). Lo script ripesca ogni nome
sconosciuto dalla sua pagina-parte risolvendo i redirect e riscrive il `tt`; quello che resta
senza corrispondenza lo elenca — **guardalo**, e' il solo vero candidato a "parte nuova".

Il merge e' deterministico e non cancella mai. Guarda il conteggio finale: una parte **nuova**
dopo che `resolve-new-parts` ha fatto il suo giro e' un campanello, non un successo. Se
`verify:wiki` era a 0 mancanti, una parte nuova e' quasi certamente un nome estratto male:
fermati e controlla la pagina prima di proseguire.

### 4. Derivare

```
npm run build:parts && npm run build
```
Il guardrail di `build:parts` deve restare verde e il ⚠️ delle parti products mancanti a 0.

### 5. Controllare che non si sia perso niente

```
npx tsx scripts/verify-parts-preserved.ts
```
Se esce diverso da 0: **fermati. Niente commit, niente registrazione.** Segnala cosa e' sparito.

### 6. Controllare la completezza

```
npm run verify:wiki -- --strict
```
Se esce 2 (parti sul wiki assenti dal master), fai **una sola** tornata di recupero: leggi le
pagine-parte esattamente elencate come MANCANTI, prendi il `tt` dal loro infobox, aggiungile a
`tmp/parts-extract-batch-daily-heal.json` e alle `extraPages` dei results, poi ripeti i punti 3-5 e
riverifica. Se restano mancanti, **annotalo nelle note e prosegui**: puo' essere il wiki avanti
(parte annunciata senza pagina prodotto), e un ciclo di recupero senza fine sarebbe peggio.

### 7. Registrare

```
npx tsx scripts/scan-wiki-updates.ts --record
```
Scrive in `data/wiki-scan.json` i revid visti. **Solo qui**: se il run muore prima, domani si
rifa' tutto da capo invece di credere di aver gia' guardato.

### 8. Committare

```
git add data/parts-master.json data/parts.json data/parts-master-conflicts.json data/wiki-scan.json
git commit -m "update parts database [data]" && git push
```
**Lista esplicita di file, mai `git add data/`**: alle 07:30 il job di raccolta fonti puo' ancora
star scrivendo le sue cache in `data/`, e finirebbero dentro a meta'.

## Note

- **Solo Beyblade X**: tieni ogni pagina il cui `Series` comincia per `Beyblade X` (le stagioni
  dell'anime sono pur sempre Beyblade X); scarta le altre generazioni.
- **Mai inventare**: nome non derivabile → `null`; parte non confermata → `status:"unverified"`.
- I nomi non-EN (KR/CN/ES/PT) NON stanno su Fandom: li aggiunge `/update-combos` come
  `aliases{kind:"community"}`.
- `source` nel master e' **provenienza**, non stato del diff: non aggiornare piu' `source.revid` a
  mano. La verita' del diff sta in `data/wiki-scan.json`.
- Le pagine wiki si tracciano in `data/wiki-scan.json`; in `scan-history.json` restano solo le
  fonti non-wiki di `/update-combos` (dedup per `contentHash`). I due file non si toccano.
- Eseguito ogni giorno alle 08:00 come primo passo di `daily-pipeline.bat`.
