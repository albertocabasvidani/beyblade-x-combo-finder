/**
 * analytics.ts — PostHog in modalità cookieless.
 *
 * `cookieless_mode: 'always'`: PostHog non scrive cookie né localStorage/sessionStorage, quindi
 * niente banner di consenso (documentazione ufficiale: "PostHog never stores data in cookies or
 * local/session storage"). Prezzo: nessun utente riconosciuto fra una visita e l'altra, e mai
 * `identify()`. Va bene: qui interessa COME si usa la ricerca, non CHI la usa.
 *
 * `track()` è sempre sicura: no-op in dev (stampa in console), silenziosa se PostHog manca
 * (adblock, script non caricato) — mai un'eccezione nella UI.
 */
import posthog from 'posthog-js';
import { POSTHOG_KEY, POSTHOG_HOST } from './analytics-config';

declare global {
  interface Window { __ph?: typeof posthog }
}

let ready = false;

/** Inizializza una sola volta per pagina. No-op in dev e senza chiave configurata. */
export function initAnalytics(): void {
  if (ready || typeof window === 'undefined') return;
  if (import.meta.env.DEV || !POSTHOG_KEY || POSTHOG_KEY.startsWith('phc_INCOLLA')) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    cookieless_mode: 'always',
    defaults: '2026-05-30',
  });
  ready = true;
  window.__ph = posthog;   // usato dagli script inline (toggle tema in header.astro, link fonti in about.astro)
}

/** Registra un evento con proprietà. */
export function track(event: string, props: Record<string, unknown> = {}): void {
  if (import.meta.env.DEV) { console.debug('[analytics]', event, props); return; }
  const ph = typeof window !== 'undefined' ? window.__ph : undefined;
  if (!ph) return;
  try { ph.capture(event, props); } catch { /* mai eccezioni in UI */ }
}
