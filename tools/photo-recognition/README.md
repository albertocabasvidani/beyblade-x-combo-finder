# Riconoscere prodotti Beyblade X da una foto

Prototipo locale assistito da Codex, senza chiamate ad API LLM a pagamento. Il codice prepara
ritagli e riferimenti, conserva le fonti e recupera i prodotti; Codex confronta visivamente
le forme e registra la proposta. Il ranking OpenCV è una baseline sperimentale, non un
riconoscitore autonomo affidabile.

## Ordine di riconoscimento

1. Individuare gli oggetti e salvare riquadri individuali. Le coordinate del primo test sono
   annotate a mano nella foto di riferimento; il prototipo non effettua il rilevamento automatico degli oggetti.
2. Confrontare **prima sagoma e struttura**: profilo esterno, numero e disposizione delle
   sezioni, inserti e chip. Il colore non decide il modello.
3. Aprire i riferimenti delle ricolorazioni dei modelli compatibili e usare il colore per
   distinguere le varianti. Se manca un riferimento della variante, aggiungerlo dal wiki.
4. Cercare il prodotto completo e recuperare ratchet e bit della configurazione di vendita.
5. Registrare alternative, fonti, revisione wiki e livello di verifica. La conferma dell’utente
   sulla lama non conferma automaticamente confezione, produttore o parti inferiori montate.

Le correzioni confermate prevalgono sui suggerimenti automatici e sulle review precedenti.
La regola generale del confronto visivo si applica soltanto ai pezzi non già confermati.

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

## Comandi PowerShell dalla radice del repository

Python 3.10+ con Pillow, NumPy e OpenCV; Node.js per il fetch delle fonti. Le dipendenze Python
sono in `tools/photo-recognition/requirements.txt`.

```powershell
python -m pip install -r tools/photo-recognition/requirements.txt

# Aggiornamento del catalogo; --pagina aggiunge una pagina al bisogno e la conserva nei run futuri.
npx --yes tsx scripts/build-products-wiki.ts --pagina "GhostCircle 4-60H"

# Salva testi e riferimenti delle varianti registrate; i download mancanti sono espliciti.
node tools/photo-recognition/sync-references.mjs
node tools/photo-recognition/sync-references.mjs --only ghost-circle-green

# Deriva il database parallelo di riconoscimento senza modificare i cataloghi di origine.
python tools/photo-recognition/recognize.py index

# Dalla lama riconosciuta ai prodotti completi, con alias TT/Hasbro.
python tools/photo-recognition/recognize.py lookup --part "Spear Scorpio" --color orange
python tools/photo-recognition/recognize.py lookup --part "Ghost Circle" --color green

# Primo caso di prova: sostituire il percorso con la foto originale.
python tools/photo-recognition/recognize.py run --image "C:\foto\lotto.png"

python -m unittest discover -s tools/photo-recognition -p test_recognize.py -v
```

Per una nuova foto creare un JSON con `id`, `referenceSize: [larghezza, altezza]` e `objects`.
Ogni oggetto ha un ID alfanumerico e un `box: [x1, y1, x2, y2]` nell’immagine orientata dopo EXIF.
Passarlo con `--regions`. Senza `review`, il report presenta i candidati e lascia il pezzo da
rivedere. Dopo il confronto, `review.variant` indica una voce di `visual-variants.json`.
`ownerConfirmedBlade` si aggiunge soltanto quando la lama viene confermata dall’utente.

## Stato del primo test

Il campione è stato scelto per leggibilità nella foto fornita: non è casuale né indipendente.
Le nove proposte iniziali ancora non confermate non sono ground truth.
Il n. 09 è **Ghost Circle verde**, confermato dall’utente dopo un errore iniziale di Codex
che lo aveva chiamato Wyvern Gale. L’errore è conservato nel fixture.

La stessa lama verde compare in **GhostCircle 4-60H**, `UX-12 02`, e **Circle Ghost 4-60LR**,
Hasbro `G2755`. Il vecchio `products.json` riportava erroneamente Hexa anche per `G2755`;
la pagina prodotto Hasbro dichiara Low Rush. Il modulo usa il catalogo aggiornato e conserva
le due combinazioni come alternative.

La baseline separa i descrittori di struttura dal colore e ordina prima per fasce di
compatibilità della forma, poi per colore entro la stessa fascia. Le distanze non sono
confidenze calibrate. Sull’attuale campione di sviluppo porta **3/10** proposte al primo posto
e **3/10** nei primi cinque. Questi risultati non autorizzano un uso automatico: la revisione
visiva di Codex rimane parte del flusso. La copertura delle immagini è inoltre sbilanciata:
molte lame hanno il solo colore base, alcune varianti hanno un riferimento fotografico aggiunto.

I test verificano configurazioni stock, alias, ricolorazioni, codici condivisi, ambiguità
TT/Hasbro, riquadri fuori foto e assenza di prodotti inventati. La validazione del catalogo
esistente segnala separatamente i due disaccordi con il vecchio catalogo (GoatTackle `BX-46`
e Ridge Triceratops `G3392`): gli assert strutturali passano, la verifica non è un via libera
su ogni dato commerciale.

## Fonti e attribuzione

Le pagine Beyblade Wiki e le relative pagine File sono collegate nei JSON e nel report.
I testi sono conservati per consentire la verifica della revisione letta; per autori e licenze
consultare la cronologia della pagina e le condizioni Fandom. Le immagini di giocattoli possono
avere diritti differenti dal testo della wiki: i metadati disponibili sono salvati insieme al
riferimento. Non assumere una licenza uniforme per tutti i file.
