/**
 * Genera le miniature delle foto dei componenti in `public/images/parts/160/`.
 *
 * Perche': l'app BeyMate (monorepo `app segnapunti beybladex`) scarica queste immagini nel
 * Combo Builder. Gli originali sono fino a 512x512 e pesano 69 MB in totale sulle 275 parti:
 * troppo da scaricare a ogni installazione nuova, e ogni bitmap decodificata occupa ~1 MB nella
 * cache Fresco, contro il tetto di 200 MB che Play impone da febbraio 2027. A 160 px di lato la
 * miniatura copre il piu' grande degli usi in-app (72 dp a densita' 2,2) e pesa una frazione.
 *
 * Idempotente: rigenera solo le miniature mancanti o piu' vecchie del proprio sorgente.
 *
 *   npm run build:thumbs
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const SORGENTE = join(process.cwd(), 'public', 'images', 'parts');
const DESTINAZIONE = join(SORGENTE, '160');
const LATO = 160;

async function mtime(percorso: string): Promise<number | null> {
  try {
    return (await stat(percorso)).mtimeMs;
  } catch {
    return null; // non esiste: da generare
  }
}

async function main(): Promise<void> {
  await mkdir(DESTINAZIONE, { recursive: true });

  const file = (await readdir(SORGENTE, { withFileTypes: true }))
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.png'))
    .map((d) => d.name)
    .sort();

  let generate = 0;
  let saltate = 0;
  let byteOrigine = 0;
  let byteThumb = 0;

  for (const nome of file) {
    const src = join(SORGENTE, nome);
    const dest = join(DESTINAZIONE, nome);
    const tSrc = await mtime(src);
    const tDest = await mtime(dest);

    if (tDest !== null && tSrc !== null && tDest >= tSrc) {
      saltate += 1;
    } else {
      await sharp(src)
        .resize(LATO, LATO, { fit: 'inside', withoutEnlargement: true })
        // `palette` quantizza a 256 colori: su foto di parti (plastica, colori piatti, sfondo
        // trasparente) e' la differenza fra 14,5 MB e 4,3 MB sul totale, misurata su 20 campioni.
        // Resta PNG: il campo `image` di bundled-parts.json porta i nomi con estensione .png, e
        // passare a WebP (2,4 MB) obbligherebbe a rigenerare quel registro e la cache dell'app.
        .png({ compressionLevel: 9, palette: true, quality: 80 })
        .toFile(dest);
      generate += 1;
    }

    byteOrigine += (await stat(src)).size;
    byteThumb += (await stat(dest)).size;
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`${file.length} parti: ${generate} miniature generate, ${saltate} gia' aggiornate`);
  console.log(`originali ${mb(byteOrigine)} MB -> miniature ${mb(byteThumb)} MB`);

  if (file.length === 0) {
    console.error(`nessun PNG in ${SORGENTE}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
