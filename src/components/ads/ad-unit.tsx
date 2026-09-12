import { useEffect, useRef, useState } from 'preact/hooks';
import { ADSENSE_CLIENT, AD_SLOTS, AD_FORMATS, type AdSlotName } from '../../lib/ads-config';

interface Props {
  name: AdSlotName;
  /** Classi del contenitore (margini, allineamento). */
  class?: string;
}

/**
 * Slot AdSense dentro l'isola Preact (gli slot fuori dall'isola usano ad-slot.astro).
 *
 * Due cautele, entrambe pagate con un `no_div` dello script AdSense:
 * - l'<ins> viene reso solo **dopo il mount** (`mounted`), mai nell'HTML statico: uno slot renderizzato
 *   lato server e poi rimpiazzato dall'idratazione lascia dei push senza contenitore;
 * - il push su `adsbygoogle` e' uno per istanza (`pushed`): ri-pushare su un <ins> gia' riempito fa
 *   fallire lo script con «already have ads in them», e la lista dei risultati si ri-renderizza a ogni
 *   filtro.
 * Non renderizza nulla in dev, senza client o senza id slot.
 */
export function AdUnit({ name, class: className = '' }: Props) {
  const [mounted, setMounted] = useState(false);
  const insRef = useRef<HTMLModElement | null>(null);
  const pushed = useRef(false);
  const slotId = AD_SLOTS[name];
  const enabled = import.meta.env.PROD && !!ADSENSE_CLIENT && !!slotId;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !enabled || pushed.current || !insRef.current) return;
    pushed.current = true;
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch {
      /* adblock o script non caricato: lo slot resta vuoto */
    }
  }, [mounted, enabled]);

  if (!enabled || !mounted) return null;

  return (
    <div class={className} data-ad-slot-name={name} data-testid={`ad-${name}`}>
      <ins
        ref={insRef}
        class="adsbygoogle"
        style="display:block"
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slotId}
        data-ad-format={AD_FORMATS[name]}
        data-full-width-responsive="true"
      />
    </div>
  );
}
