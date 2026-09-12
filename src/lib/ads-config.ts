// Google AdSense. Vuoto = nessuno script e nessuno slot renderizzato (anche in produzione): si
// compila dopo l'approvazione del sito, insieme a public/ads.txt (riga fornita da AdSense).
// Il consenso GDPR/CCPA lo gestisce il messaggio «Privacy & messaging» di AdSense (CMP certificata
// Google), nessun codice nostro. Gli annunci compaiono solo in produzione (import.meta.env.PROD).
export const ADSENSE_CLIENT = 'ca-pub-7303361297226779';
export const AD_SLOTS = {
  top: '',                                    // id slot annuncio sopra la ricerca
  bottom: '',                                 // id slot annuncio sotto i risultati
} as const;
export type AdSlotName = keyof typeof AD_SLOTS;
