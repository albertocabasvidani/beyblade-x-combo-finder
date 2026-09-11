// Project API key di PostHog (cloud EU). È una chiave di sola ingestione, pubblica per costruzione:
// finisce comunque nel bundle servito a chiunque apra il sito. Committata di proposito: un secret di
// GitHub Actions non aggiungerebbe riservatezza, solo un modo silenzioso di deployare il sito senza
// analytics. Finché resta il placeholder, l'analytics è spenta (vedi analytics.ts).
export const POSTHOG_KEY: string = import.meta.env.PUBLIC_POSTHOG_KEY ?? 'phc_INCOLLA_QUI';
export const POSTHOG_HOST = 'https://eu.i.posthog.com';
