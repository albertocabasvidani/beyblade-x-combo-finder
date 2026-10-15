# Beyblade X Combo Finder

Per struttura, pipeline e vincoli generali del progetto leggere anche `CLAUDE.md`.

## Riconoscimento da foto

Prima di lavorare sul riconoscimento leggere `tools/photo-recognition/README.md`.

- Confrontare prima la forma della lama, poi il colore per scegliere la ricolorazione.
- Per le CX confrontare lock chip e main blade e consultare l’atlante CX: una lama componibile non ha un ID `blade` monolitico. Il fallback di un componente va dichiarato.
- Il colore da solo non identifica una lama. Consultare le varianti del modello prima di assegnare una confidenza alta.
- Risalire al prodotto completo: ratchet e bit vengono dalla combinazione di vendita documentata nella pagina prodotto.
- Conservare separatamente combinazioni Takara Tomy e Hasbro quando montano parti diverse, anche se condividono la stessa lama e livrea.
- Una correzione dell’utente prevale sul riconoscimento visivo: salvarla nel caso di prova, mantenendo traccia dell’errore precedente.
- `data/products-wiki.json` è il catalogo prodotti persistente. Lo scraper supporta `--pagina "Titolo wiki"` per aggiungere una pagina senza perdere quelle già salvate.
- Le fonti e i riferimenti visivi aggiunti al bisogno stanno in `data/recognition/`. Ritagli, foto dell’utente e report locali stanno in `tmp/recognition/`.
- Riutilizzare prima i prodotti e le fonti locali. `index`, `lookup` e `run` funzionano senza rete; `sync-references.mjs` consulta la wiki solo per fonti assenti o con `--refresh` esplicito.
- Il ranking OpenCV è sperimentale. Non presentare le sue distanze come probabilità o le proposte di Codex come etichette confermate.
- Generare ogni preview con `recognize.py` e i template versionati in `tools/photo-recognition/templates/`. Riutilizzare struttura, stile e numerazione; cambiare il formato solo su richiesta dell’utente.

Verifica del modulo: `python -m unittest discover -s tools/photo-recognition -p test_recognize.py -v`.
