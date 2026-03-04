Aggiorna il database combo Beyblade X cercando le migliori combo raccomandate dalle fonti configurate.

## Istruzioni

1. **Leggi configurazione**: Leggi `data/sources.json`, `data/combos.json`, `data/parts.json` e `data/scan-history.json`.

2. **Determina modalità scansione**:
   - Se `scan-history.json` → `lastFullScan` è null: esegui **scansione iniziale** (ultimi 12 mesi)
   - Altrimenti: esegui **scansione incrementale** (solo contenuti nuovi)

---

### Fase 1 — Cache files (raccolti dagli script automatici)

Prima di iniziare l'analisi, leggi i file cache prodotti dagli script di raccolta dati:
- `data/reddit-cache.json` — Post e commenti da r/Beyblade (scraper dedicato)
- `data/youtube-cache.json` — Video recenti dai canali YouTube monitorati (YouTube API v3)
- `data/sheets-cache.json` — Dati dalle tab del Google Sheet tier list (Sheets API v4)

Se un file cache non esiste o è vuoto, salta quella fonte (lo script potrebbe non essere ancora stato eseguito).

Analizza il contenuto di ogni cache file per estrarre combo. I video YouTube contengono combo nei titoli e nelle descrizioni. I post Reddit contengono combo nei body e nei commenti.

### Fase 2 — Fonti website (beybase, wbo, beybxdb)

Per ogni fonte con `type: "website"` che ha `provides: "combos"` o `provides: "both"`:
- Usa WebSearch con le `searchQueries` configurate
- Usa WebFetch sugli `urls` specifici
- Cerca anche query generiche: `best beyblade x combos`, `beyblade x tier list`, `beyblade x meta combos`, `beyblade x tournament winning combos`
- Confronta con `scannedPages` in scan-history: se l'URL è già stato scansionato e il contenuto non è cambiato, salta
- Aggiorna `scannedPages[url]` con `lastScannedDate` e `contentHash` (primi 100 char del contenuto)

---

## Estrazione combo

Per ogni fonte analizzata:
- **BX/UX**: Estrai blade + ratchet + bit (es. "Shark Edge 3-60 Ball")
- **CX**: Estrai lockChip + mainBlade + assistBlade + ratchet + bit (es. "Dran Brave S 6-60 Ball")
- Normalizza i nomi parti agli ID presenti in `data/parts.json`
- Se una parte menzionata non esiste in parts.json, **aggiungila** (con `name` e `nameWestern` se noto)

## Calcola score

Per ogni combo trovata:
```
score = (sourceReliability × 0.4) + (frequency × 0.35) + (recency × 0.25)
```
- **sourceReliability**: media pesata dei `weight` delle fonti (da sources.json)
- **frequency**: normalizzato 0-10 in base a quante fonti indipendenti la raccomandano
- **recency**: basato sulla data della fonte più recente (30gg=10, 60gg=8, 90gg=6, 180gg=4, oltre=2)

## Tipo e tags

- **Tipo**: attack/defense/stamina/balance basato sul tipo del blade
- **Tags**: "meta" se score ≥ 9.0, "top-tier" se ≥ 8.0, "tournament-proven" se fonte torneo

## Merge

- Combo esistente (stesso ID parti) → aggiorna score, fonti, note, dateUpdated
- Combo nuova → aggiungi con ID univoco (formato: blade-ratchet-bit)
- NON rimuovere combo esistenti
- Aggiorna `lastUpdated` nel file

## Finalizzazione

1. Scrivi `data/combos.json` e `data/parts.json` (se nuove parti)
2. Aggiorna `data/scan-history.json`:
   - Imposta `lastFullScan` alla data odierna (se era scansione iniziale)
   - Aggiorna `scannedVideos`, `scannedSheets`, `scannedPages`
3. Esegui `npm run build` per verificare la compilazione
4. Report: nuove combo, combo aggiornate, nuove parti, fonti consultate, video scansionati (nuovi vs già noti)
5. Git: `git add data/` → commit "update combos database [data]" → push

## Note importanti

- **MAI inventare combo**: Solo combo effettivamente raccomandate da almeno una fonte
- **MAI includere l'anno nelle query di ricerca** (es. NO "2026")
- **Normalizzazione**: I nomi devono corrispondere ESATTAMENTE agli ID in parts.json
- **Fonti**: Registra sempre URL e data della fonte nel campo `sources` della combo
- **Incrementale**: La scansione incrementale è il caso normale. La scansione iniziale avviene solo la prima volta
- **Ignora fonti `provides: "parts"`**: Questo comando si occupa solo delle combo
