// @ts-check
import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://albertocabasvidani.github.io',
  base: '/beyblade-x-combo-finder',
  output: 'static',
  integrations: [preact()],

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