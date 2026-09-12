// Google AdSense. Uno slot con id vuoto non renderizza nulla (nemmeno in produzione): gli id si
// compilano dopo aver creato le unità annuncio nel pannello AdSense, insieme a public/ads.txt.
// Il consenso GDPR/CCPA lo gestisce il messaggio «Privacy & messaging» di AdSense (CMP certificata
// Google), nessun codice nostro. Gli annunci compaiono solo in produzione (import.meta.env.PROD).
export const ADSENSE_CLIENT = 'ca-pub-7303361297226779';
export const AD_SLOTS = {
  top: '2893429591',                          // bxcombos-top: banner sopra il contenuto (.astro)
  rail: '8552950383',                         // bxcombos-rail: fondo del pannello parti (isola Preact)
  infeed: '7497432742',                       // bxcombos-infeed: fra le card del ranking (isola Preact)
  bottom: '1580347920',                       // bxcombos-bottom: sotto i risultati (.astro)
} as const;
export type AdSlotName = keyof typeof AD_SLOTS;

// Formato per slot. `auto` lascia decidere ad AdSense e su mobile riserva un rettangolo alto quanto
// mezza schermata: sui banner in cima e in fondo si usa `horizontal`, che riserva una striscia.
export const AD_FORMATS: Record<AdSlotName, string> = {
  top: 'horizontal',
  rail: 'auto',
  infeed: 'auto',
  bottom: 'horizontal',
};

// Posizione degli annunci in-feed nella lista dei risultati: il primo dopo la 6ª card (sotto la
// piega, quando l'utente ha già visto il podio), poi uno ogni 20. Con 60 card per pagina sono 3.
export const INFEED_AFTER = 6;
export const INFEED_EVERY = 20;
