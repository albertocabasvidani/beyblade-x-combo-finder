# Riconoscere prodotti Beyblade X da una foto

Prototipo locale assistito da Codex, senza chiamate ad API LLM a pagamento. Il codice prepara
ritagli e riferimenti, conserva le fonti e recupera i prodotti; Codex confronta visivamente
le forme e registra la proposta. Il ranking OpenCV è una baseline sperimentale, non un
riconoscitore autonomo affidabile.

## Ordine di riconoscimento

1. Individuare gli oggetti e salvare riquadri individuali. Le coordinate del primo test sono
   annotate a mano nella foto di riferimento; il prototipo non effettua il rilevamento automatico degli oggetti.
2. Confrontare **prima sagoma e struttura**: profilo esterno, numero e disposizione delle
   sezioni, inserti e chip. Il colore non decide il modello. Per i CX confrontare lock chip
   e main blade con `atlas-cx.jpg`, oltre al prodotto montato quando la foto è disponibile.
3. Aprire i riferimenti delle ricolorazioni dei modelli compatibili e usare il colore per
   distinguere le varianti. Se manca un riferimento della variante, aggiungerlo dal wiki.
4. Cercare il prodotto completo e recuperare ratchet e bit della configurazione di vendita.
5. Registrare alternative, fonti, revisione wiki e livello di verifica. La conferma dell’utente
   sulla lama non conferma automaticamente confezione, produttore o parti inferiori montate.

Le correzioni confermate prevalgono sui suggerimenti automatici e sulle review precedenti.
La regola generale del confronto visivo si applica soltanto ai pezzi non già confermati.

Prima di ogni ricerca usare i dati locali. `index`, `lookup` e `run` non effettuano richieste
di rete. Il salvataggio delle fonti salta completamente le pagine già acquisite, anche se
qualche immagine aveva dato errore: torna online soltanto per una fonte assente oppure con
`--refresh` richiesto esplicitamente. L’aggiornamento completo del catalogo è un’operazione
separata dal riconoscimento di una foto.

## Dati persistenti

- `data/parts-master.json` e `public/images/parts/`: registro parti e immagini esistenti.
- `data/products-wiki.json`: catalogo completo persistente generato dallo scraper esistente,
  con Beyblade, confezioni, rilasci TT/Hasbro e codici. Aggiornato durante il test.
- `data/recognition/visual-variants.json`: collegamenti curati tra variante visiva e prodotto,
  comprese le alternative commerciali indistinguibili nella foto.
- `data/recognition/sources/`: snapshot del wikitext originale, URL, revisione, data,
  metadati delle immagini e tentativi falliti di download. La pagina `/wiki/` può essere
  bloccata: lo scraper usa l’API MediaWiki `api.php`.
- `data/recognition/images/`: riferimenti dei prodotti scaricati dal CDN, quando disponibili.
  La cache verifica gli hash dei file e mantiene i riferimenti validi nei run successivi.
- `data/recognition/test-photo-01.json`: dieci riquadri, proposte di Codex, correzioni e stato
  di conferma. Le immagini dell’utente non vengono incluse nel repository.
- `tmp/recognition/<caso>/`: database parallelo derivato `catalog.json`, ritagli, foto numerata,
  tavole di confronto, risultati JSON e report HTML autocontenuto. Si possono rigenerare.

Il database derivato contiene prodotti, combinazioni e offerte commerciali separati. Un codice
condiviso come `BX-00` non è una chiave sufficiente: l’identità include il prodotto.
Le righe Hasbro non si deducono traducendo il nome: usano i codici e le parti dichiarati dal wiki.

## Preview fissa

La preview usa il formato `recognition-v1`, salvato in `templates/report.html`,
`templates/card.html` e `templates/pending-card.html`. Il renderer inserisce soltanto i dati:
non ricrea HTML o CSS per ogni lotto. Riutilizzare questi template; modificare il formato
soltanto su richiesta dell’utente.

La struttura rimane: riepilogo e conteggio conferme, foto con riquadri numerati, schede nello
stesso ordine dei riquadri. Ogni scheda presenta ritaglio e riferimento affiancati, prodotto
completo, codice, ratchet e bit, eventuali parti CX e alternative, fonti e stato di conferma.
Gli oggetti senza proposta restano nello stesso elenco come «da rivedere». Il numero di
oggetti, le immagini, le identificazioni e le conferme sono variabili; layout e campi sono fissi.

Il file generato `tmp/recognition/<caso>/report.html` è autocontenuto e funziona senza rete.
I test verificano lo stesso formato con oggetti confermati, proposti e ancora da rivedere.

## Comandi PowerShell dalla radice del repository

Python 3.10+ con Pillow, NumPy e OpenCV; Node.js per il fetch delle fonti. Le dipendenze Python
sono in `tools/photo-recognition/requirements.txt`.

```powershell
python -m pip install -r tools/photo-recognition/requirements.txt

# Aggiornamento del catalogo; --pagina aggiunge una pagina al bisogno e la conserva nei run futuri.
npx --yes tsx scripts/build-products-wiki.ts --pagina "GhostCircle 4-60H"

# Salva soltanto le fonti assenti; riusa quelle già salvate senza interrogare la wiki.
node tools/photo-recognition/sync-references.mjs
node tools/photo-recognition/sync-references.mjs --only ghost-circle-green

# Solo quando si vuole aggiornare una fonte o riprovare un'immagine mancante.
node tools/photo-recognition/sync-references.mjs --only ghost-circle-green --refresh

# Deriva il database parallelo di riconoscimento senza modificare i cataloghi di origine.
python tools/photo-recognition/recognize.py index

# Dalla lama riconosciuta ai prodotti completi, con alias TT/Hasbro.
python tools/photo-recognition/recognize.py lookup --part "Spear Scorpio" --color orange
python tools/photo-recognition/recognize.py lookup --part "Ghost Circle" --color green

# Primo caso di prova: sostituire il percorso con la foto originale.
python tools/photo-recognition/recognize.py run --image "C:\foto\lotto.png"

python -m unittest discover -s tools/photo-recognition -p test_recognize.py -v
node tools/photo-recognition/test-local-cache.mjs
```

Per una nuova foto creare un JSON con `id`, `referenceSize: [larghezza, altezza]` e `objects`.
Ogni oggetto ha un ID alfanumerico e un `box: [x1, y1, x2, y2]` nell’immagine orientata dopo EXIF.
Passarlo con `--regions`. Senza `review`, il report presenta i candidati e lascia il pezzo da
rivedere. Dopo il confronto, `review.variant` indica una voce di `visual-variants.json`.
`ownerConfirmedBlade` si aggiunge soltanto quando la lama viene confermata dall’utente.
Per un CX `ownerConfirmedIdentity` contiene `cx:<lockChip>/<mainBlade>`: si mantiene `blade: null`
e si registrano i componenti separati, senza inventare una lama monolitica.

## Stato del primo test

Il campione è stato scelto per leggibilità nella foto fornita: non è casuale né indipendente.
L’utente ha confermato i dieci modelli dopo due correzioni: il n. 07 è **Rhino Reaper**,
inizialmente chiamato Unicorn Sting, e il n. 09 è **Ghost Circle verde**, inizialmente chiamato
Wyvern Gale. La prima passata visiva di Codex aveva quindi identificato **8 modelli su 10**.
Le correzioni e la prima misura sono conservate nel fixture; il risultato corretto non è una
nuova misurazione indipendente dell’accuratezza.

**RhinoReaper C4-55D** è un CX: lock chip Rhino, main blade Reaper, assist blade Charge,
ratchet 4-55 e bit Dot. Esce nel `CX-05 02` e nello starter Hasbro `G2746`.
Il catalogo lo conteneva già, ma il primo ranking visivo escludeva i CX: ora il confronto
gestisce identità composte, atlante CX e fallback esplicito alla main blade se manca la foto montata.

La stessa lama verde compare in **GhostCircle 4-60H**, `UX-12 02`, e **Circle Ghost 4-60LR**,
Hasbro `G2755`. Il vecchio `products.json` riportava erroneamente Hexa anche per `G2755`;
la pagina prodotto Hasbro dichiara Low Rush. Il modulo usa il catalogo aggiornato e conserva
le due combinazioni come alternative.

La baseline separa i descrittori di struttura dal colore e ordina prima per fasce di
compatibilità della forma, poi per colore entro la stessa fascia. Le distanze non sono
confidenze calibrate. Il confronto aggiornato è scritto in `results.json` e nel report,
con conteggio delle etichette confermate distinto dalle proposte. Il ranking resta sperimentale:
la revisione visiva di Codex rimane parte del flusso. La copertura delle immagini è inoltre sbilanciata:
molte lame hanno il solo colore base, alcune varianti hanno un riferimento fotografico aggiunto.

I test verificano configurazioni stock, alias, ricolorazioni, codici condivisi, ambiguità
TT/Hasbro, prodotti CX completi, riquadri fuori foto e assenza di prodotti inventati. La validazione del catalogo
esistente segnala separatamente i due disaccordi con il vecchio catalogo (GoatTackle `BX-46`
e Ridge Triceratops `G3392`): gli assert strutturali passano, la verifica non è un via libera
su ogni dato commerciale.

## Fonti e attribuzione

Le pagine Beyblade Wiki e le relative pagine File sono collegate nei JSON e nel report.
I testi sono conservati per consentire la verifica della revisione letta; per autori e licenze
consultare la cronologia della pagina e le condizioni Fandom. Le immagini di giocattoli possono
avere diritti differenti dal testo della wiki: i metadati disponibili sono salvati insieme al
riferimento. Non assumere una licenza uniforme per tutti i file.
