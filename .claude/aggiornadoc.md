# Documenti da tenere aggiornati — Beyblade X Combo Finder

<!-- Manifest di /aggiornadoc. Modificabile a mano: le righe qui sotto sono decisioni, non un elenco di file. -->

| Documento | Quando aggiornarlo | Ultimo aggiornamento | Chiusure senza modifiche |
|---|---|---|---|
| CLAUDE.md | architettura, comandi npm, vincoli verificati sul campo, scheduling dei job, trappole di API e servizi esterni | 12/09/2026 | 0 |
| README.md | utilizzo, installazione, comandi, cosa vede chi apre il sito | 12/09/2026 | 0 |
| projects/combo-pipeline.md | ogni run o modifica di raccolta, parser, scoring, pruning, automazione | 12/09/2026 | 0 |
| projects/web-frontend.md | ogni modifica al sito Astro/Preact, ad analytics, affiliazione e annunci | 12/09/2026 | 0 |
| projects/parts-database.md | modifiche a parts-master, derivazione, verify:wiki, immagini delle parti | 20/08/2026 | 1 |
| docs/scoring-algorithm.md | cambia l'algoritmo CAS, i pesi, le costanti o le finestre temporali | 11/09/2026 | 0 |
| docs/redesign-arena.md | cambia il design system (token, tipografia, componenti dell'interfaccia) | 17/06/2026 | 2 |

## Esclusi

- `projects/INDEX.md` — si rigenera con `/dashboard`, non si scrive a mano.
- `docs/audit-avversariale-2026-06-16.md` — documento storico, fotografia di quella data.
- `plans/` — gitignorato in questo repo: i piani si aggiornano su disco ma non entrano nei commit.
- `tmp/` — scratch, gitignorato.

## Note

- Il repo ha **due cloni**: questo (sviluppo) e `C:\Users\server\progetti\beyblade-combos` sul
  homeserver, dove gira l'automazione. Dopo un push, sul server serve `git pull`.
- La pipeline notturna committa da sé (`update combos database`, `mine reddit combos`, e all'occorrenza
  correzioni al codice: il 12/09/2026 il commit `98d4bf2` sul parser WBO è suo). Prima di scrivere un
  changelog, guardare `git log` del mattino: parte del lavoro può non essere dell'operatore.
