Aggiorna il database delle parti Beyblade X cercando nuovi prodotti rilasciati.

## Istruzioni

1. **Leggi lo stato attuale**: Leggi `data/parts.json` e `data/scan-history.json`.

2. **Cerca nuovi prodotti**: Usa WebSearch con queste query:
   - `"beyblade x" new release blade`
   - `"beyblade x" new product ratchet bit`
   - `"beyblade x" CX new lock chip main blade assist blade`
   - `site:beyblade.fandom.com beyblade x parts list`
   - `site:beybxdb.com parts`
   - `"beyblade x" BX- new set`
   - `"beyblade x" UX- new set`
   - `"beyblade x" CX- new set`

3. **Consulta fonti dirette**: Usa WebFetch su queste pagine (solo se non già scansionate di recente in `scannedPages`):
   - https://beyblade.fandom.com/wiki/List_of_Beyblade_X_products_(Takara_Tomy)
   - https://beyblade.fandom.com/wiki/List_of_Beyblade_X_products_(Hasbro)
   - https://beyblade.fandom.com/wiki/Category:Beyblade_X_Blades
   - https://beyblade.fandom.com/wiki/Category:Beyblade_X_Ratchets
   - https://beyblade.fandom.com/wiki/Category:Beyblade_X_Bits
   - https://www.beybxdb.com/

4. **Identifica parti nuove**: Confronta con `data/parts.json`. Per ogni parte nuova:
   - **Blades (BX/UX)**: `id` (kebab-case), `name` (TT), `nameWestern` (Hasbro, se diverso), `type`, `line: "bx"`, `releaseSet`
   - **Lock Chips (CX)**: `id`, `name`, `nameWestern` (se diverso), `line: "cx"`
   - **Main Blades (CX)**: `id`, `name`, `nameWestern` (se diverso), `line: "cx"`
   - **Assist Blades (CX)**: `id`, `name`, `shortName` (lettera), `line: "cx"`
   - **Ratchets**: `id` (es. "3-60"), `name`, `sides`, `height`
   - **Bits**: `id` (kebab-case), `name`, `type`

5. **Regole di normalizzazione**:
   - `id`: kebab-case basato sul nome TT (es. "shark-edge", "hells-scythe")
   - `name`: nome TT/Eastern con spazi (es. "Shark Edge", "Hells Scythe")
   - `nameWestern`: nome Hasbro solo se diverso dal TT (es. "Keel Shark", "Scythe Incendio")
   - Ratchet: `sides` = primo numero, `height` = secondo (3-60 → sides:3, height:60)
   - Assist Blades: `shortName` = lettera singola (es. "S" per Slash)
   - Non aggiungere parti non verificate — meglio meno parti ma corrette
   - **MAI includere l'anno nelle query di ricerca**

6. **Aggiorna files**:
   - `data/parts.json`: aggiorna `version`, aggiungi parti in ordine alfabetico per `id`
   - `data/scan-history.json`: aggiorna `scannedPages` per le pagine visitate

7. **Verifica**: Esegui `npm run build` per verificare la compilazione.

8. **Report**: Elenca parti aggiunte o "Nessuna nuova parte trovata."

9. **Git**: Se ci sono modifiche: `git add data/` → commit "update parts database [data]" → push
