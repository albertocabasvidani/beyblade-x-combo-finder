import { useEffect, useRef } from 'preact/hooks';
import { ADSENSE_CLIENT, AD_SLOTS, type AdSlotName } from '../../lib/ads-config';

interface Props {
  name: AdSlotName;
  /** Classi del contenitore (margini, allineamento). */
  class?: string;
}

/**
 * Slot AdSense dentro l'isola Preact (gli slot fuori dall'isola usano ad-slot.astro).
 * Il push su `adsbygoogle` avviene una volta sola per istanza: ri-pushare su un <ins> già riempito
 * fa fallire lo script con «already have ads in them», e la lista dei risultati si ri-renderizza a
 * ogni filtro. Non renderizza nulla in dev, senza client o senza id slot.
 */
export function AdUnit({ name, class: className = '' }: Props) {
  const pushed = useRef(false);
  const slotId = AD_SLOTS[name];
  const enabled = import.meta.env.PROD && !!ADSENSE_CLIENT && !!slotId;

  useEffect(() => {
    if (!enabled || pushed.current) return;
    pushed.current = true;
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch {
      /* adblock o script non caricato: lo slot resta vuoto */
    }
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div class={className} data-ad-slot-name={name} data-testid={`ad-${name}`}>
      <ins
        class="adsbygoogle"
        style="display:block"
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
