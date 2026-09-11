/**
 * /robots.txt — generato a build così l'URL della sitemap segue `site` + `base` di astro.config.mjs
 * (oggi GitHub Pages sotto /beyblade-x-combo-finder, domani il dominio beybladexcombos.com).
 */
import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const sitemap = `${(site ?? new URL('http://localhost')).origin}${base}/sitemap-index.xml`;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
