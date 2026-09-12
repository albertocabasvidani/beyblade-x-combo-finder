// Google AdSense. Uno slot con id vuoto non renderizza nulla (nemmeno in produzione): gli id si
// compilano dopo aver creato le unità annuncio nel pannello AdSense, insieme a public/ads.txt.
// Il consenso GDPR/CCPA lo gestisce il messaggio «Privacy & messaging» di AdSense (CMP certificata
// Google), nessun codice nostro. Gli annunci compaiono solo in produzione (import.meta.env.PROD).
export const ADSENSE_CLIENT = 'ca-pub-7303361297226779';
export const AD_SLOTS = {
  top: '',                                    // banner orizzontale sopra il contenuto (.astro)
  rail: '',                                   // rettangolo in fondo al pannello parti (isola Preact)
  infeed: '',                                 // dentro il ranking, fra le card (isola Preact)
  bottom: '',                                 // sotto i risultati (.astro)
} as const;
export type AdSlotName = keyof typeof AD_SLOTS;

// Posizione degli annunci in-feed nella lista dei risultati: il primo dopo la 6ª card (sotto la
// piega, quando l'utente ha già visto il podio), poi uno ogni 20. Con 60 card per pagina sono 3.
export const INFEED_AFTER = 6;
export const INFEED_EVERY = 20;
