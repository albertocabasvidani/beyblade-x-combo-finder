/**
 * Genera le miniature delle foto dei componenti in `public/images/parts/160/`.
 *
 * Perche': l'app BeyMate (monorepo `app segnapunti beybladex`) scarica queste immagini nel
 * Combo Builder. Gli originali sono fino a 512x512 e pesano 69 MB in totale sulle 275 parti:
 * troppo da scaricare a ogni installazione nuova, e ogni bitmap decodificata occupa ~1 MB nella
 * cache Fresco, contro il tetto di 200 MB che Play impone da febbraio 2027. A 160 px di lato la
 * miniatura copre il piu' grande degli usi in-app (72 dp a densita' 2,2) e pesa una frazione.
 *
 * Lo sfondo diventa trasparente per tutte: 42 originali su 275 (Hasbro, Star Wars, Marvel,
 * Transformers) sono foto su fondo bianco o grigio chiaro, e nell'app stanno su una card scura.
 * Il fondo si riconosce dal colore piu' frequente lungo il bordo e si cancella per riempimento
 * dal bordo (flood fill), cosi' un bianco chiuso dentro la parte resta; i pixel di contorno
 * sfumati verso il fondo prendono un'alpha proporzionale, per non lasciare l'alone chiaro.
 * Gli originali non si toccano: li usa il sito.
 *
 * Idempotente: rigenera solo le miniature mancanti o piu' vecchie del proprio sorgente o di
 * questo script.
 *
 *   npm run build:thumbs
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SORGENTE = join(process.cwd(), 'public', 'images', 'parts');
const DESTINAZIONE = join(SORGENTE, '160');
const LATO = 160;
const QUESTO_SCRIPT = fileURLToPath(import.meta.url);

/** Distanza massima (per canale) dal colore di fondo per considerare un pixel "fondo". */
const TOLLERANZA_FONDO = 14;
/** Sotto questa distanza un pixel di contorno e' un misto parte/fondo: alpha proporzionale. */
const TOLLERANZA_CONTORNO = 72;

type Raw = { data: Buffer; width: number; height: number };

/** Colore piu' frequente lungo il bordo (quantizzato a 4 livelli per canale, poi media esatta). */
function coloreDiFondo({ data, width, height }: Raw): [number, number, number] | null {
  const conteggio = new Map<number, { n: number; r: number; g: number; b: number }>();
  let trasparenti = 0;
  let totale = 0;
  const campiona = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    totale += 1;
    if (data[i + 3] < 128) {
      trasparenti += 1;
      return;
    }
    const chiave = (data[i] >> 2) * 4096 + (data[i + 1] >> 2) * 64 + (data[i + 2] >> 2);
    const voce = conteggio.get(chiave) ?? { n: 0, r: 0, g: 0, b: 0 };
    voce.n += 1;
    voce.r += data[i];
    voce.g += data[i + 1];
    voce.b += data[i + 2];
    conteggio.set(chiave, voce);
  };
  for (let x = 0; x < width; x += 1) {
    campiona(x, 0);
    campiona(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    campiona(0, y);
    campiona(width - 1, y);
  }
  // Bordo gia' trasparente per almeno meta': l'originale ha gia' il fondo giusto.
  if (trasparenti * 2 >= totale) return null;
  let migliore: { n: number; r: number; g: number; b: number } | null = null;
  for (const voce of conteggio.values()) if (!migliore || voce.n > migliore.n) migliore = voce;
  if (!migliore) return null;
  return [migliore.r / migliore.n, migliore.g / migliore.n, migliore.b / migliore.n];
}

/** Riempimento dal bordo: azzera l'alpha del fondo connesso al bordo, sfuma il contorno. */
function rimuoviSfondo(raw: Raw, fondo: [number, number, number]): void {
  const { data, width, height } = raw;
  const n = width * height;
  const distanza = (i: number) =>
    Math.max(
      Math.abs(data[i * 4] - fondo[0]),
      Math.abs(data[i * 4 + 1] - fondo[1]),
      Math.abs(data[i * 4 + 2] - fondo[2])
    );
  const eFondo = new Uint8Array(n);
  const coda: number[] = [];
  const spingi = (i: number) => {
    if (eFondo[i] || data[i * 4 + 3] === 0 || distanza(i) > TOLLERANZA_FONDO) return;
    eFondo[i] = 1;
    coda.push(i);
  };
  for (let x = 0; x < width; x += 1) {
    spingi(x);
    spingi((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    spingi(y * width);
    spingi(y * width + width - 1);
  }
  while (coda.length) {
    const i = coda.pop() as number;
    const x = i % width;
    if (x > 0) spingi(i - 1);
    if (x < width - 1) spingi(i + 1);
    if (i >= width) spingi(i - width);
    if (i + width < n) spingi(i + width);
  }
  for (let i = 0; i < n; i += 1) {
    if (eFondo[i]) {
      data[i * 4 + 3] = 0;
      continue;
    }
    const x = i % width;
    const vicinoAlFondo =
      (x > 0 && eFondo[i - 1]) ||
      (x < width - 1 && eFondo[i + 1]) ||
      (i >= width && eFondo[i - width]) ||
      (i + width < n && eFondo[i + width]);
    if (!vicinoAlFondo) continue;
    const d = distanza(i);
    if (d < TOLLERANZA_CONTORNO) {
      data[i * 4 + 3] = Math.round((data[i * 4 + 3] * d) / TOLLERANZA_CONTORNO);
    }
  }
}

/** Buffer raw RGBA dell'originale, con lo sfondo reso trasparente se serviva. */
async function origineSenzaSfondo(src: string): Promise<{ raw: Raw; ripulita: boolean }> {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = { data, width: info.width, height: info.height };
  const fondo = coloreDiFondo(raw);
  if (fondo) rimuoviSfondo(raw, fondo);
  return { raw, ripulita: fondo !== null };
}

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
  let ripulite = 0;
  let byteOrigine = 0;
  let byteThumb = 0;
  const tScript = (await mtime(QUESTO_SCRIPT)) ?? 0;

  for (const nome of file) {
    const src = join(SORGENTE, nome);
    const dest = join(DESTINAZIONE, nome);
    const tSrc = await mtime(src);
    const tDest = await mtime(dest);

    if (tDest !== null && tSrc !== null && tDest >= tSrc && tDest >= tScript) {
      saltate += 1;
    } else {
      const { raw, ripulita } = await origineSenzaSfondo(src);
      if (ripulita) ripulite += 1;
      await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
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
  console.log(
    `${file.length} parti: ${generate} miniature generate (${ripulite} con lo sfondo reso trasparente), ${saltate} gia' aggiornate`
  );
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
