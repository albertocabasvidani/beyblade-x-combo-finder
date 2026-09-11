/**
 * /combos.json — dataset ridotto delle combo per l'isola di ricerca (vedi src/lib/slim-combos.ts).
 * Prerenderizzato a build: finisce in dist/combos.json e GitHub Pages lo serve compresso.
 */
import type { APIRoute } from 'astro';
import combosData from '../../data/combos.json';
import { toSlim } from '../lib/slim-combos';
import type { CombosDatabase } from '../lib/types';

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(JSON.stringify(toSlim(combosData as unknown as CombosDatabase)), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
