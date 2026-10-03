/**
 * Miniatura della foto di un componente. Usa le stesse immagini 160 px dell'app BeyMate
 * (`public/images/parts/160/`, `npm run build:thumbs`): sfondo trasparente per tutte, ~15 KB l'una,
 * contro i ~250 KB degli originali da 512 px. Caricamento lazy: le card sotto la piega non scaricano
 * niente finché non si scorre.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const thumbUrl = (file: string) => `${BASE}/images/parts/160/${file}`;

interface Props {
  /** Nome del file (campo `image` della parte); assente = la parte non ha ancora una foto. */
  file?: string;
  name: string;
  /** Lato in px del riquadro. */
  size: number;
  /** Senza riquadro: per i chip colorati, dove il fondo scuro stonerebbe. */
  plain?: boolean;
}

export function PartThumb({ file, name, size, plain = false }: Props) {
  return (
    // Markup minimo e stile in global.css (.part-thumb): la home ne rende ~180 lato server.
    // alt vuoto: il nome della parte è già scritto accanto (titolo della card, voce della ricerca).
    <span class={plain ? 'part-thumb part-thumb-plain' : 'part-thumb'} style={`--s:${size}px`} title={name}>
      {file ? (
        <img src={thumbUrl(file)} alt="" loading="lazy" />
      ) : (
        // Senza foto: l'iniziale, così la fila di miniature resta allineata.
        <span class="font-display text-[13px] uppercase text-muted-2" aria-hidden="true">{name.slice(0, 1)}</span>
      )}
    </span>
  );
}
