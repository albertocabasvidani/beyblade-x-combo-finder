/**
 * parse-bbx-weekly.ts — Estrae da bbx-weekly-cache.json un segnale usage PER-PARTE, ANCORATO al
 * registro parti (parts.json): cerca nel testo solo i nomi di parti NOTE seguiti da una percentuale.
 * Così non produce rumore su un layout ignoto e degrada a vuoto se non trova nulla.
 *
 * Output: data/bbx-weekly-evidence.json. È un CROSS-CHECK indipendente (freschezza + usage-parte):
 * NON entra nello score CAS (che resta basato su placement per-evento). Niente doppio conteggio
 * perché BBX classifica parti, non combo/eventi.
 *
 * Nota: l'estrazione è best-effort e va riverificata sul layout reale di bbxweekly.com; se la fonte
 * cambia struttura, il file resta valido (lista vuota) e va aggiornato il pattern.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_PATH = join(ROOT, 'data', 'bbx-weekly-cache.json');
const PARTS_PATH = join(ROOT, 'data', 'parts.json');
const OUT_PATH = join(ROOT, 'data', 'bbx-weekly-evidence.json');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// BBX Weekly espone un INDICE di ranking 0-100 per parte (non una percentuale): nel testo ogni parte
// è "Nome\n<numero>" (eventuale freccia ▲/▼ sta PRIMA del nome). Catturiamo quel numero come `score`.
interface PartUsage { partId: string; category: string; name: string; score: number; window: string }

function main() {
  if (!existsSync(CACHE_PATH)) {
    writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), parts: [] }, null, 2) + '\n');
    console.log('bbx-weekly: nessun cache, scritto evidence vuoto.');
    return;
  }
  const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  const parts = JSON.parse(readFileSync(PARTS_PATH, 'utf-8'));

  // Registro (partId, category, name): nomi e shortName delle categorie rilevanti.
  const registry: { id: string; category: string; name: string }[] = [];
  const cats: [string, string][] = [
    ['blades', 'blade'], ['ratchets', 'ratchet'], ['bits', 'bit'],
    ['lockChips', 'lockChip'], ['mainBlades', 'mainBlade'], ['assistBlades', 'assistBlade'], ['overBlades', 'overBlade'],
  ];
  for (const [key, category] of cats) {
    for (const p of parts[key] ?? []) {
      // include name + nameWestern + alias + shortName: BBX usa nomi inglesi, a volte con ordine
      // parole diverso dal master (es. "Wyvern Hover" vs "Hover Wyvern") → più chiavi = più match.
      for (const nm of [p.name, p.nameWestern, ...(p.aliases ?? []), p.shortName]) {
        if (nm && String(nm).length > 1) registry.push({ id: p.id, category, name: String(nm) });
      }
    }
  }
  // nomi più lunghi prima: evita che "Rod" matchi dentro "Wizard Rod"
  registry.sort((a, b) => b.name.length - a.name.length);

  const out: PartUsage[] = [];
  const seen = new Set<string>();
  for (const pg of cache.pages ?? []) {
    const text: string = '\n' + (pg.text ?? '');
    for (const r of registry) {
      const key = `${pg.window}|${r.category}|${r.id}`;
      if (seen.has(key)) continue;
      // formato BBX: il nome è su una riga, il punteggio (0-100) sulla riga dopo. Anco­rato a \n per
      // non matchare sotto-stringhe (es. "Ball" dentro "Free Ball").
      const re = new RegExp(`\\n${esc(r.name)}\\n\\s*(\\d{1,3})(?!\\d)`, 'i');
      const m = text.match(re);
      if (!m) continue;
      seen.add(key);
      out.push({ partId: r.id, category: r.category, name: r.name, score: parseInt(m[1], 10), window: pg.window });
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), parts: out }, null, 2) + '\n');
  console.log(`bbx-weekly: ${out.length} parti con usage estratte (cross-check, fuori dal CAS). → ${OUT_PATH}`);
}

main();
