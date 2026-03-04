// @ts-check
import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';
import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),
  output: 'static',
  integrations: [preact()],

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'it'],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: true,
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
});