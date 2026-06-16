# Spec di design — Direzione "Arena"

Riferimento per l'implementazione del redesign UI. Valori estratti fedelmente dal mockup
`Arena - Mobile & Desktop` del progetto claude.ai/design "Beyblade X combo finder".

Font caricati: **Anton** (peso unico), **Saira** (400/500/600/700), **JetBrains Mono** (500/700).

Modello finale (rispetto alle 3 direzioni esplorate): **niente hero**, **niente tab BX/CX**, **niente
toggle TT/Hasbro**, **niente CTA/link Amazon**. La linea CX è indicata solo da un badge "CX" sul nome
combo + striscia laterale viola.

---

## 1. Design tokens

### Tema scuro

**Background / superfici**
- `#0c0a0d` — background app (telefono interno, top bar desktop, area contenuto desktop)
- `#050406` — scocca/telaio del telefono
- `#16131a` — superficie input/toggle/chip su mobile (search, toggle confronto)
- `#141014` — card combo non-#1; left rail desktop (su desktop search/toggle/chip usano `#0c0a0d` come fondo)
- `#1a161d` — chrome del browser desktop
- card #1 gradiente: `linear-gradient(135deg,#1d1410,#120e10)` (mobile) / `linear-gradient(120deg,#1d1410,#120e10)` (desktop)

**Bordi**
- `#2a2430` — bordo standard (input, card non-#1, divisori rail, track toggle off)
- `#1c1620` — bordo header / top bar
- `#ffb01f44` — bordo card #1 (oro trasparente)
- `#3a3340` — bordo dashed chip "+ suggeriti"
- `#ffffff10` / `#ffffff0d` / `#ffffff14` — separatori interni alle card (hairline bianco tenue)
- `#ff433255` / `#ff433266` — bordo del filtro/chip scarlatto attivo

**Testo**
- `#ffffff` — primario (titoli, nomi combo, "Le tue parti")
- `#e4dde0` — su superficie (label toggle "Confronta…")
- `#d8dde6` — status bar
- `#c9bfc4` — riga evidenza torneo
- `#c79bf5` — testo badge "CX"
- `#8a7f86` — secondario/muted (nav inattiva, "Info", placeholder off)
- `#6f6570` — muted forte (placeholder search, "N fonti", sub-label toggle)
- `#5a5258` — micro-label rail desktop ("Suggeriti", "Filtri")

**Accenti**
- **Oro `#ffb01f`** — logo, toggle on, rank #1, "🏆 N vittorie", barra "Ranking", nav attiva, bordo/glow card #1
- `#1a1100` — testo scuro su chip oro selezionati; `#1a110055` — fondo pallino ✕
- **Scarlatto `#ff4332`** — filtro "Provate in torneo" on, "N% meta", base gradiente striscia card #1
- `#ff7a6e` — testo chip parte mancante ("! …")

**Tipo combo** (chip pieno, testo bianco)
- ATK / Attacco: `#d23b34`
- STA / Stamina: `#1f9d5b`
- DEF, BAL: non presenti nel mockup → scegliere coerenti (proposta: DEF `#3b82c4` blu, BAL `#a855f7` viola)

**Fasce CAS** (badge "notch", gradiente verticale)
- **Meta** (≥ ~8): `linear-gradient(180deg,#3bdc86,#1f9d5b)`, testo `#052413`
- **Top-tier** (~7): `linear-gradient(180deg,#f1c64a,#d99c1f)`, testo `#2a2103`
- **Solida** (~6): `linear-gradient(180deg,#f0a050,#e07a22)`, testo `#2a1603`

**Striscia laterale card** (4–5px, per posizione)
- #1: `linear-gradient(180deg,#ffb01f,#ff4332)` (oro→scarlatto)
- #2 (BX/UX standard): `#4a4350` (grigio)
- #3 CX: `#b07cf0` (viola — marca la linea CX)

**Stato parte**
- Posseduta (✓): fondo `#1f9d5b22`, bordo `#1f9d5b66`, testo `#5fe0a0`
- Mancante (!): fondo `#ff433215`, bordo `#ff433255`, testo `#ff7a6e` — **senza** freccia/link
- Badge CX: testo `#c79bf5`, bordo `#b07cf066`

**Rank number**: #1 `#ffb01f`; #2/#3 `#8a7f86`.

**Barre meta-share** (solo desktop): track `#2a2430`; fill #1 `linear-gradient(90deg,#ffb01f,#ff4332)`; fill #2 `#d99c1f`; fill #3 `#e07a22`.

### Tema chiaro

**Background / superfici**
- `#f6f1ea` — background app
- `#ffffff` — card combo, top bar desktop, search mobile, rail desktop
- `#faf6ef` — toggle "Confronta…" (mobile e rail); search/chip-suggeriti rail desktop
- `#ece6dc` — chrome browser desktop

**Bordi**
- `#e7ded2` — standard (input, card non-#1, toggle)
- `#ede3d3` — header mobile; `#ece3d4` — top bar / divisori desktop
- `#f3c98a` — bordo card #1 (oro chiaro)
- `#d8cebc` — dashed chip "+ suggeriti"
- `#f0e7d9` — separatori interni card; track meta-share
- `#e0392c55` — bordo filtro scarlatto attivo

**Testo**
- `#1b1410` — primario
- `#54504a` / `#6f6557` — secondario (riga evidenza `#6f6557`)
- `#9a8f80` — muted ("Info", sub-label toggle)
- `#a89c8b` — muted forte ("N fonti", placeholder, "37 combo")
- `#b0a594` — micro-label / icona search; rank #2/#3; "Suggeriti"/"Filtri"
- `#8a7f70` — nav inattiva, label filtro off

**Accenti**
- **Oro `#f59e0b`** — logo, toggle on, barra Ranking, fill barre
- `#e07d00` — variante oro più scura per testo (rank #1, "🏆 N vittorie", nav "Home")
- `#2a1a00` — testo su chip oro selezionati; `#2a1a0026` — fondo pallino ✕
- **Scarlatto `#e0392c`** — filtro on, "N% meta", base gradiente striscia card #1
- `#b02a20` — testo filtro scarlatto attivo (mobile); `#cf3022` — testo chip parte mancante

**Tipo combo**: Stamina `#15914f`; Attacco `#e0392c`.

**Fasce CAS**
- Meta: `linear-gradient(180deg,#34c87f,#15914f)`, testo **`#fff`** (nel chiaro il #1 ha testo bianco)
- Top-tier: `linear-gradient(180deg,#f5c542,#d99008)`, testo `#2a2103`
- Solida: `linear-gradient(180deg,#f0a050,#e07a22)`, testo `#2a1603`

**Striscia laterale**: #1 `linear-gradient(180deg,#f59e0b,#e0392c)`; #2 `#cdc4b4`; #3 CX `#b07cf0`.

**Stato parte**
- Posseduta (✓): fondo `#e7f6ee`, testo `#15914f` — **senza bordo** (differenza col dark)
- Mancante (!): fondo `#fdecea`, testo `#cf3022` — senza bordo, senza link
- Badge CX: testo `#8b5cf6`, fondo `#f1ecfe` (pieno, non bordato)

**Rank**: #1 `#e07d00`; #2/#3 `#b0a594`. **Barre**: track `#f0e7d9`; fill #1 `linear-gradient(90deg,#f59e0b,#e0392c)`; #2 `#d99008`; #3 `#e07a22`.

---

## 2. Tipografia

- **Display / titoli / nomi combo / rank / badge CAS** → `'Anton', sans-serif` (weight 400),
  `text-transform: uppercase`, `letter-spacing 0.005em–0.02em`. **Rank** e **numero CAS** in `font-style: italic`.
- **Body / UI / label / chip / evidenza** → `'Saira', sans-serif`. Pesi 600 (label/nav/evidenza), 700
  (chip parte, chip selezionati, badge tipo); body 400/500.
- **Mono / micro-label / meta** → `'JetBrains Mono', monospace` (500/700). Eyebrow, micro-label
  "Suggeriti"/"Filtri", URL browser, badge lettera. `uppercase`, `letter-spacing 0.1em–0.14em`.

**Scala font-size**
- Logo "Combo Finder": 17px (mobile) / 21px (desktop) Anton.
- Titolo sezione "Le tue parti" / "Ranking": 17–18px (mobile) / 19px (rail) / 24px ("Ranking" desktop).
- Nome combo: 17px (mobile) / 22px (desktop) Anton uppercase; CX leggermente ridotto (16px / 21px).
- Rank number: 26px (mobile) / 38px (desktop) Anton italic.
- Badge CAS numero: 22px (mobile) / 30px (desktop) Anton italic; etichetta fascia sotto 7.5–8.5px Saira 700 uppercase.
- Badge tipo: 9.5px (mobile) / 10px (desktop) Saira 700 uppercase, `letter-spacing 0.05em`.
- Riga evidenza torneo: 11.5px (mobile) / 12.5px (desktop) Saira 600.
- Chip parte: 11px (mobile, 10.5px su CX) / 11.5px (desktop, 11px su CX) Saira 700.
- Label/micro: 13–13.5px label toggle/search; 11px label filtro mobile; 10–10.5px micro-label mono.

---

## 3. Spacing / radius / shadow / effetti

**Radius**
- Telefono scocca 40px; schermo interno 32px.
- Card combo 14px (rail/card desktop 16px).
- Input / toggle / search 11px. Chip parte aggiunta/suggerita 9px. Chip ✓/! 6px (callout 7px).
- Badge tipo 4px (mobile) / 5px (desktop); badge CX 4px. Filtri "pill" 999px. Track toggle 9–11px.

**Spacing (padding)**
- Schermata mobile: header `12px 18px`; selettore `16px 18px 18px`; lista ranking `0 16px 20px`, `gap 11px`.
- Top bar desktop `16px 32px`; griglia contenuto desktop `28px 40px 40px`, `gap 28px`.
- Card mobile `13px 14px 13px 18px` (più spazio a sinistra per la striscia). Card desktop `16px 20px 16px 26px`, riga con `gap 18px`.
- Separatori interni card: `margin-top 11px; padding-top 11px; border-top` hairline.

**Shadow**
- Telefono dark `0 30px 60px -24px rgba(20,15,20,0.55)`; light `0 30px 60px -24px rgba(60,55,48,0.4)`.
- Card #1 dark mobile `0 0 0 1px #ffb01f18, 0 10px 30px -16px #ffb01f55`; desktop `0 0 0 1px #ffb01f15, 0 14px 34px -20px #ffb01f66`.
- Card #1 light `0 10px 26px -16px rgba(245,158,11,0.45)` (mobile) / `0 14px 32px -22px rgba(245,158,11,0.5)` (desktop).
- Card non-#1 light `0 6px 18px -12px rgba(60,55,48,0.16–0.2)`; nel dark le non-#1 sono piatte (solo bordo).

**Effetti**
- **Badge CAS notch**: `clip-path: polygon(0 0, 100% 0, 100% 78%, 50% 100%, 0 78%)` (mobile) / `…80%…80%` (desktop) — punta verso il basso, gradiente verticale per fascia.
- **Striscia laterale**: barra assoluta `width 4px` (mobile) / `5px` (desktop), `height 100%`, top-left; contenitore card `position:relative; overflow:hidden`.
- **Barra "Ranking"**: `linear-gradient(90deg,#ffb01f,transparent)` (dark) / `#f59e0b` (light), height 2px, flex:1.
- **Logo "X" skew**: contenitore `transform: skewX(-10deg)` + glifo `skewX(10deg)` per restare dritto.
- **Meta-share bar** (solo desktop): track 5px radius 3px, fill a %.
- NON necessari (erano solo nella Direzione 2): glow radiali hero, strisce `repeating-linear-gradient`, tab skewate, banner Amazon.

---

## 4. Struttura per schermo

Comune ai 4 schermi: niente hero, niente tab BX/CX, niente toggle TT/Hasbro, niente CTA Amazon.

### Mobile (scuro e chiaro), dall'alto
1. **Header** compatto (`12px 18px`, border-bottom): logo skew "X" + "COMBO FINDER" (Anton uppercase) a sx; "INFO" muted a dx.
2. **Selettore "Le tue parti"** (blocco unico, non a tab):
   - Titolo "Le tue parti" (Anton 17px).
   - **Toggle "Confronta con le mie parti"**: label + sub-label "Evidenzia ✓ possedute e ! mancanti" + switch (on = oro).
   - **Search bar** unica: icona ⌕ + placeholder "Cerca Blade, Ratchet, Bit, Lock Chip…". Un solo campo per tutte le categorie.
   - **Chip parti possedute** (pieni oro + ✕), seguiti da chip "**+ Nome**" tratteggiati (suggerimenti).
   - **Filtri**: 2 pill affiancate (`gap 8px`, flex:1) — "Provate in torneo" (on = scarlatto), "Meta / top-tier" (off = grigio).
3. **Header ranking**: "RANKING" (Anton) + barra gradiente oro + conteggio "N combo".
4. **Lista combo card** (colonna, `gap 11px`).

### Desktop (scuro e chiaro)
1. **Top bar** app (`16px 32px`, border-bottom; nel light fondo bianco): logo skew + "COMBO FINDER" a sx; nav uppercase `gap 28px` a dx: "HOME" (attiva, oro), "INFO", "COME FUNZIONA IL PUNTEGGIO".
2. **Griglia 2 colonne**: `grid-template-columns: 340px 1fr; gap: 28px`.
   - **Left rail (340px)**: titolo Anton 19px, toggle "Confronta…", search ("Cerca una parte…"), chip
     possedute (oro + ✕), micro-label mono "SUGGERITI" + chip "+ …", divisore hairline, micro-label "FILTRI"
     + righe toggle (label sx, switch dx): "Provate in torneo", "Meta / top-tier". Switch desktop 36×20px.
   - **Colonna destra (1fr)**: header "RANKING" (Anton 24px) + barra gradiente + "N combo · ordinate per CAS";
     poi lista di **righe orizzontali**.

---

## 5. Anatomia combo card

### Mobile (card verticale)
Radius 14px, striscia laterale 4px a sx, padding `13px 14px 13px 18px`.
- **Riga 1** (space-between): a sx blocco `rank + testo`; a dx **badge CAS notch**.
  - Rank: Anton italic 26px (oro per #1, grigio altrimenti).
  - Nome combo (Anton uppercase 17px); se CX, badge "CX" prima del nome; sotto, badge tipo pieno + "N fonti" (muted).
  - Badge CAS: gettone clip-path, gradiente per fascia, numero Anton italic 22px + etichetta fascia 7.5px.
- **Riga evidenza** (separata da hairline): "🏆 N vittorie" (oro) · "N tornei" / "N top-cut" · "N% meta" (scarlatto). Saira 600 11.5px. **Niente barra meta-share su mobile.**
- **Riga chip parti** (`gap 6px`, wrap): ✓ posseduta (verde) e ! mancante (scarlatto), una per parte. CX fino a 6 chip con font/padding ridotti. I chip mancanti **senza** ↗ né link Amazon.

### Desktop (riga orizzontale)
Radius 14px, striscia 5px, padding `16px 20px 16px 26px`, `display:flex; align-items:center; gap:18px`. Da sx a dx:
1. **Rank** Anton italic 38px.
2. **Blocco centrale (flex:1)**: nome combo (Anton 22px, badge "CX" inline se CX) + riga sotto con badge tipo e **i chip ✓/! inline sulla stessa riga**.
3. **Colonna evidenza (188px, border-left hairline, padding-left 18px)**: "🏆 N vittorie · N tornei"; "N% meta share" (scarlatto); **barra meta-share** (solo desktop).
4. **Badge CAS notch** (numero 30px), all'estrema destra.

---

## 6. Differenze tema chiaro vs scuro (oltre ai colori)

- Struttura identica (header, selettore unico, 2 filtri, griglia 340px+1fr, anatomia card).
- Badge CAS Meta: testo **bianco** nel light, **verde scurissimo** (`#052413`) nel dark. Top-tier/Solida testo scuro in entrambi.
- Chip ✓/!: nel **dark hanno bordo**, nel **light no** (solo fondo + testo).
- Badge CX: dark bordato (`#b07cf066`, testo `#c79bf5`); light pieno (`#f1ecfe`, testo `#8b5cf6`).
- Ombre: nel light tutte le card e il rail hanno ombra morbida; nel dark solo la card #1 ha glow.
- Top bar desktop: nel light fondo bianco esplicito; nel dark stesso fondo del contenuto + border-bottom.
- Switch off: dark track `#2a2430` + knob `#6f6570`; light track `#e0d8ca` + knob `#fff`.

---

## 7. Note di implementazione (Astro + Preact + Tailwind v4)

- **Google Fonts**: `Anton`, `Saira:400;500;600;700`, `JetBrains Mono:500;700`. Mappare in `@theme`:
  `--font-display: 'Anton'`, `--font-sans: 'Saira'`, `--font-mono: 'JetBrains Mono'`.
- **Temi**: definire i token come CSS custom properties con override su `[data-theme]` + `@theme inline`
  (i token statici di `@theme` non bastano per il toggle runtime). Molte tinte non sono inversioni.
- **Badge CAS notch / striscia laterale / logo skew**: replicabili 1:1 con clip-path / pseudo-elementi /
  doppio skew. Nessuna immagine necessaria.
- **Numeri** rank e CAS: Anton in `font-style: italic` (oblique sintetica — look voluto). Non usano un font mono.
- **Responsive**: breakpoint implicito `lg` (~1024px) per passare da card verticale a riga orizzontale,
  comparsa colonna evidenza (188px) e barra meta-share, e dalla colonna unica alla griglia `340px 1fr`.
- **Icone testuali** nel mockup: `⌕` `✕` `✓` `!` `🏆`. Valutare un set SVG per coerenza cross-platform delle emoji.
- **Dati d'esempio** nel mockup: Wizard Rod 1-60 Hexa (Stamina/Meta 8.6); Shark Scale 1-70 Low Rush
  (Attacco/Top-tier 7.0); Phoenix Flow Flare H 3-60 Kick (CX/Attacco/Solida 6.4).
