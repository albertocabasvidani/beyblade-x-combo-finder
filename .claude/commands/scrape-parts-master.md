Import iniziale (one-shot) del database parti master multilingua da Beyblade Fandom Wiki.

Costruisce/arricchisce `data/parts-master.json` (file canonico con nomi TT/Hasbro/giapponese + alias
multilingua), da cui `npm run build:parts` deriva `data/parts.json` preservando gli id esistenti.
Tutta la lettura e il match dei nomi li fa l'IA (questo comando + subagent); il codice fa solo
derivazione e validazione. Solo Beyblade X.

## Accesso alle pagine (IMPORTANTE)

- Usare SEMPRE l'**API MediaWiki**, mai la pagina renderizzata (`/wiki/...` dà 403/Cloudflare):
  `https://beyblade.fandom.com/api.php?action=parse&page=TITLE&format=json&prop=wikitext`
  (negli URL sostituire gli spazi del titolo con `_`).
- Le date/revisioni: `...&prop=revisions&rvprop=ids|timestamp` (batch fino a 50 titoli con
  `action=query&titles=A|B|...`).

## Prerequisiti

1. Se `data/parts-master.json` non esiste, crealo come base dagli id esistenti:
   `npx tsx scripts/bootstrap-master.ts` (popola tt/hasbro da parts.json; ja/romaji/aliases vuoti).
2. La worklist dei prodotti X è in `tmp/parts-scrape-worklist.json` (191 prodotti, dedup). Se manca,
   rigenerala leggendo le 4 sezioni di `List_of_Beyblade_X_products_(Takara_Tomy)` e le sezioni di
   `List_of_Beyblade_X_products_(Hasbro)` ed estraendo i link `[[Pagina]]`.
3. Lista delle parti note ancora mancanti (da `npm run build:parts`, sezione ⚠️): includile
   esplicitamente come obiettivi dell'import (es. blade `dran-strike`, `bullet-gryphon`; bit `quake`,
   `variable`; ratchet `1-50`, `M-85`; mainBlade `flame`, `blitz`; lockChip `cerberus`, `leon`…).

## Fase 1 — Fan-out estrazione (subagent in parallelo)

Suddividi la worklist in ~10 lotti (~20 pagine ciascuno) e lancia un subagent per lotto, **in
parallelo**, con QUESTO prompt (validato su DranSword BX e DranBrave CX):

> Estrai le PARTI dalle pagine prodotto Beyblade X indicate, leggendo via WebFetch sull'API MediaWiki
> (`https://beyblade.fandom.com/api.php?action=parse&page=TITLE&format=json&prop=wikitext`, spazi→`_`).
> Per ogni pagina, dall'infobox `{{Beyblade Infobox}}`:
> - `ProductCode` → codice TT (`BX-/UX-/CX-`) **e** codice Hasbro (`F####/G####`).
> - `Type`; `System`→line (Basic→bx, Unique→ux, Custom→cx); `Series` → se ≠ "Beyblade X" SCARTA.
> - Componenti: BX/UX = `BladeX`+`Ratchet`+`Bit`; CX = `LockChip`+`MainBlade`+`AssistBlade`+`Ratchet`+`Bit`.
> - **BX/UX** (1 blade, mappatura 1:1): TT = `BladeX` spaziato; Hasbro = segmento `AKA (Hasbro)` senza
>   ratchet/bit; JP = porzione di `JPName` PRIMA del primo `{{Ruby}}`; romaji = prima parola di `RomajiName`.
> - **CX**: NON derivare i nomi Hasbro dal nome prodotto (ordine non corrispondente). Per ogni parte CX
>   LEGGI la pagina dedicata: `Main Blade - {MainBlade}`, `Lock Chip - {LockChip}`, `Assist Blade - {AssistBlade}`;
>   prendi TT/JP/romaji e Hasbro SOLO dal suo `AKA (Hasbro)`; se la pagina parte non ha `AKA`, Hasbro = null.
> - `{{Ruby|base|reading}}`→tieni `base`; rimuovi `[[...]]` (tieni testo), `'' ''`.
> Restituisci JSON: un oggetto per prodotto con `pageTitle, isBeybladeX, line, type, productCodes{tt,hasbro},
> parts{ blade?, lockChip?, mainBlade?, assistBlade?(+short), ratchet, bit }` dove ogni parte ha
> `{ tt, hasbro|null, ja, romaji }` (ratchet/bit: almeno `tt`; hasbro/ja null se non presenti). Riporta
> per ogni pagina parte CX letta l'URL API usato. Non inventare: campo assente → null.

Le pagine parte CX (`Main Blade - X` ecc.) sono condivise tra molti prodotti: i subagent possono
rileggerle (la cache di WebFetch dedup entro 15 min) oppure assegnale a un lotto dedicato.

### Casi limite (emersi dal pilota CX — includili sempre nel prompt)

- **`tt` è il NOME della parte** (es. "Wolf", "Hunt"), **mai** il codice prodotto. Confermalo col
  `JPName` della pagina parte (ウルフ = Wolf). Un subagent che mette "CX-10" in `tt` ha sbagliato.
- **Tipo per-parte**: `parts.json` richiede `type` (attack/defense/stamina/balance) per blade e bit.
  Non è il `Type` del prodotto: leggi il campo `Type` dall'infobox della **pagina parte** (blade/bit).
- **Sistema Expand Blade** (CX recenti, `System2=Expand Blade`, es. CX-13/14/15): l'infobox NON ha
  `MainBlade` ma `OverBlade` + `MetalBlade`. Mappa `mainBlade = MetalBlade` (coerente con products.json)
  e registra l'`OverBlade` (Break/Guard/Flow) come `aliases{kind:"variant"}`/nota; non è (ancora) un
  campo separato del modello.
- **RatchetBit integrato** (es. PegasusBlast `Turbo`, campo `RatchetBit`): `ratchet = null`, `bit` = il valore.
- **ja/romaji di ratchet e bit**: dalle pagine `Ratchet - {X}` / `Bit - {X}` se esistono; l'`AKA` di
  quelle pagine è spesso solo l'abbreviazione (V, LO, DB), NON un nome Hasbro → `hasbro = null`.
- **Discrepanze products.json ↔ wiki** (es. `products.json` CX-01 bit `variable` ma il wiki dice
  `Vortex`): la verità è il **wiki**; registra la discrepanza in `parts-master-conflicts.json`.
- **Set / Random Booster / Dual Pack / Multipack**: la pagina contiene PIÙ bey (non un singolo
  infobox). Estrai ogni bey elencato; molti rimandano alla pagina del prodotto singolo (riusa quella).

## Fase 2 — Assemblaggio + mappatura id (tu, agente principale)

Unisci i record dei subagent e fondili nel master per **parte fisica** (non per prodotto):

1. Per ogni parte estratta calcola la chiave normalizzata (lowercase, senza spazi/trattini) di `tt`,
   `hasbro`, `ttRaw`. Trova la voce esistente nel master con precedenza: id esatto → tt norm → hasbro
   norm → ttRaw norm.
2. **Match trovato** → ARRICCHISCI la voce: completa `names.ja/romaji/hasbro` se vuoti, aggiungi
   `aliases` (hasbro/native/romaji/anime), accumula `products` (codici TT+Hasbro), imposta
   `firstReleaseSet` (il codice più antico), `source{page,url,revid}`, `lastVerified`, `status:"verified"`.
   Non sovrascrivere un valore già presente con uno diverso senza segnalarlo nei conflitti.
3. **Nessun match** → AGGIUNGI nuova voce con id kebab-case di `tt` (convenzione esistente:
   `dran-sword`, `hells-scythe`). Per assistBlade `shortName` = lettera dal product code/Ruby.
4. **Parti esistenti nel master non trovate nel wiki** → NON rimuoverle: lascia la voce (status
   resta `unverified`) e annotala in `data/parts-master-conflicts.json`.
5. Copri esplicitamente le parti elencate nel ⚠️ di `build:parts`: se una di esse non compare in
   nessuna pagina prodotto, cerca la sua pagina dedicata o la pagina prodotto della prima release.

## Fase 3 — Conflitti

Scrivi `data/parts-master-conflicts.json` con i casi che NON risolvi da solo:
- due parti che normalizzano allo stesso id (remold/duplicato),
- id esistente senza match nel wiki (orfano / possibile non-X),
- mismatch di `type` o di `hasbro` tra estrazione e valore esistente.

## Fase 4 — Derivazione e verifica

1. `npm run build:parts` → rigenera `data/parts.json`. Il guardrail combos deve restare verde; il ⚠️
   delle parti products mancanti deve ridursi (idealmente a 0).
2. `npm run build` per confermare la compilazione.
3. Esegui `/verify-parts-master` e rivedi il report + i conflitti.
4. Aggiorna `data/scan-history.json` `scannedPages` con `{revid, timestamp, lastScannedDate}` per ogni
   pagina letta (serve all'update incrementale).
5. Git: `git add data/ scripts/` → commit `import parts master da Fandom [data]` → push.

## Note

- **Solo Beyblade X**: scarta qualsiasi pagina con `Series ≠ "Beyblade X"`.
- **Mai inventare**: un nome non derivabile resta `null`; una parte non confermata resta `unverified`.
- I nomi nelle lingue diverse da TT/Hasbro/JP (KR/CN/ES/PT…) NON stanno su Fandom EN: verranno aggiunti
  come `aliases{kind:"community"}` dalla pipeline combo quando incontrati nelle fonti.
