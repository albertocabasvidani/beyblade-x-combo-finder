// @ts-check
import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Origine e base path del sito. Default: GitHub Pages sotto /beyblade-x-combo-finder. Il giorno del
// passaggio al dominio beybladexcombos.com si cambiano i due default (SITE_ORIGIN → https://beybladexcombos.com,
// SITE_BASE → '/') e si aggiunge public/CNAME; le variabili d'ambiente servono a provare il passaggio
// prima di committarlo (es. `SITE_BASE=/ npm run build`).
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://albertocabasvidani.github.io';
const SITE_BASE = process.env.SITE_BASE ?? '/beyblade-x-combo-finder';

// https://astro.build/config
export default defineConfig({
  site: SITE_ORIGIN,
  base: SITE_BASE,
  output: 'static',
  integrations: [
    preact(),
    // Solo le pagine HTML: l'endpoint /combos.json e /robots.txt non vanno nella sitemap.
    sitemap({ filter: (page) => !/\.(json|txt)$/.test(page) }),
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'it'],
    routing: {
      // Sito monolingua EN servito dalla root: niente prefisso /en/ né redirect.
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
