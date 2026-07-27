# Dashboard sottoprogetti — 27/07/2026

| Progetto | Status | Health | Backlog | Bug | Prossimo step | Aggiornato |
|---|---|---|---|---|---|---|
| [parts-database](parts-database.md) | active | 🟢 | 1 | 1 | "revisionare i casi ambigui in data/parts-master-conflicts.json (revisione umana)" | 27/07/2026 |
| [combo-pipeline](combo-pipeline.md) | active | 🟡 | 4 | 3 | `/update-combos` in pausa: `combos.json` congelato, niente estrazione né pruning finché non si cancella `.pausa-update-combos` | 27/07/2026 |
| [web-frontend](web-frontend.md) | active | 🟢 | 3 | 0 | "pagine dettaglio combo /combo/[id] (SSG) per SEO (non ancora implementate)" | 17/06/2026 |

## Avvisi

- **`/update-combos` è in pausa dal 27/07** (`.pausa-update-combos`): `combos.json` resta indietro, il sito con lui. La pipeline gira lo stesso — raccolta, `/update-parts` e `/mine-reddit` sono attivi — quindi il silenzio non segnala niente. Dal 03/08 il cross-check di BBX Weekly lo dirà nel log della raccolta, con parole di attesa e non di guasto.
- `next-step` rimosso da `combo-pipeline.md` (contenuto migrato in Backlog). `parts-database.md` e `web-frontend.md` lo contengono ancora: vanno migrati uno alla volta, non cancellati — il campo può essere l'unica traccia di un lavoro.

<!-- Generato da /dashboard il 2026-07-27, aggiornato a mano dopo l'audit del dispatcher -->
