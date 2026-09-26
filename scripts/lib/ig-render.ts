/**
 * ig-render.ts — Da un candidato (scripts/lib/ig-posts.ts) alle slide HTML 1080×1350 e alla didascalia.
 *
 * Solo stringhe: le immagini delle parti arrivano già come data URI (le legge ig-generate.ts), così la
 * pagina si renderizza con `setContent` senza server né file. Stile del sito (Anton/Saira, arancione su
 * nero); il layout è quello provato nel mockup del 26/09/2026 (tmp/ig-mockup.cjs), scalato ×2,5.
 */
import type { PostCandidate } from './ig-posts';

export interface RenderCtx {
  name: (id: string) => string;      // nome leggibile di una parte
  img: (id: string) => string;       // data URI dell'immagine, o '' se manca
  asOf: string;                      // gg/mm/aaaa dei dati
}

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const it = (n: number, d = 0) => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number) => it(100 * x, 1) + '%';
const dmy = (iso: string) => iso.split('-').reverse().join('/');

export const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Anton&family=Saira:wght@400;600;800&display=swap');
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{width:1080px;height:1350px;overflow:hidden;background:#0c0c0e;color:#fff;font-family:Saira,sans-serif;
    background-image:radial-gradient(ellipse at 20% 0%,#2a1a05 0%,transparent 55%),radial-gradient(ellipse at 100% 100%,#101c33 0%,transparent 50%)}
  .slide{position:relative;width:1080px;height:1350px;padding:84px 76px}
  .kicker{font-size:27px;letter-spacing:.2em;color:#f5a623;font-weight:600;text-transform:uppercase}
  h1{font-family:Anton,sans-serif;font-weight:400;font-size:130px;line-height:.95;margin:34px 0 26px;letter-spacing:.01em;text-transform:uppercase}
  h1 em{font-style:normal;color:#f5a623}
  .hero{width:520px;height:520px;object-fit:contain;display:block;margin:16px auto 0;filter:drop-shadow(0 26px 50px rgba(0,0,0,.7))}
  .sub{font-size:40px;line-height:1.25;color:#e0e0e0;margin-top:26px;max-width:880px}
  .url{font-family:Anton,sans-serif;font-size:76px;color:#f5a623;margin-top:70px}
  .foot{position:absolute;left:76px;right:76px;bottom:56px;font-size:31px;line-height:1.35;color:#bbb;letter-spacing:.02em}
  .row{display:flex;align-items:center;gap:44px;margin-top:36px}
  .row img,.row .noimg{width:260px;height:260px;flex:none;object-fit:contain;filter:drop-shadow(0 16px 30px rgba(0,0,0,.7))}
  .lbl{font-size:27px;letter-spacing:.25em;color:#f5a623;font-weight:600}
  .val{font-family:Anton,sans-serif;font-size:100px;line-height:1;margin-top:10px}
  .val.small{font-size:64px;color:#aaa}
  .proof{margin-top:44px;font-size:35px;line-height:1.3;color:#e0e0e0;border-left:8px solid #f5a623;padding-left:30px}
  .grid5{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:20px}
  .grid5 img{width:240px;height:240px;object-fit:contain;filter:drop-shadow(0 16px 30px rgba(0,0,0,.7))}
  ol{list-style:none;padding:0;margin:44px 0 0}
  li{display:flex;align-items:center;gap:30px;padding:24px 0;border-bottom:2px solid #26262c}
  li img{width:140px;height:140px;flex:none;object-fit:contain}
  .pos{font-family:Anton,sans-serif;font-size:76px;color:#f5a623;width:70px;flex:none}
  .nm{font-weight:800;font-size:44px;flex:1;line-height:1.05}
  .pd{font-size:32px;color:#aaa;text-align:right;flex:none}
  .bigrow{display:flex;align-items:center;gap:44px;margin-top:56px}
  .big{font-family:Anton,sans-serif;font-size:220px;line-height:.9;color:#f5a623}
  .big.dim{color:#777;font-size:160px}
  .arrow{font-size:100px;color:#f5a623}
  ol.mini{margin-top:24px} ol.mini li{padding:18px 0} ol.mini img{width:110px;height:110px}
`;

export function wrap(inner: string): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="slide">${inner}</div></body></html>`;
}

const foot = (txt: string) => `<div class="foot">${esc(txt)} · beybladexcombos.com</div>`;

function partRow(ctx: RenderCtx, label: string, id: string | null): string {
  if (!id) return `<div class="row"><div class="noimg"></div><div><div class="lbl">${label}</div><div class="val small">integrato nella lama</div></div></div>`;
  const src = ctx.img(id);
  return `<div class="row">${src ? `<img src="${src}" alt="">` : '<div class="noimg"></div>'}<div><div class="lbl">${label}</div><div class="val">${esc(ctx.name(id))}</div></div></div>`;
}

interface Build { name: string; blade: string; ratchet: string | null; bit: string; type: string; topCut: number; wins: number; events: number }
const proof = (b: Build, period: string) => `${b.topCut} top cut · ${b.wins} vittorie · ${b.events} tornei ${period}`;

function comboSlide(ctx: RenderCtx, kicker: string, b: Build, period: string, footer: string): string {
  return wrap(`<div class="kicker">${esc(kicker)}</div>${partRow(ctx, 'LAMA', b.blade)}${partRow(ctx, 'RATCHET', b.ratchet)}${partRow(ctx, 'BIT', b.bit)}<div class="proof">${esc(proof(b, period))}</div>${foot(footer)}`);
}

/** Slide di un post «le build meta per X» (tipi build-lama e build-lama-nuova). */
function bladeBuildSlides(ctx: RenderCtx, c: PostCandidate): string[] {
  const d = c.data as { blade: string; tournaments: number; topCut: number; share: number; firstSeen: string; builds: Build[] };
  const nome = ctx.name(d.blade);
  const nuova = c.type === 'build-lama-nuova';
  const period = 'negli ultimi 3 mesi';
  const slides = [wrap(`
    <div class="kicker">BEYBLADE X · ${nuova ? 'NUOVA LAMA' : 'BUILD META'}</div>
    <h1>LE BUILD<br>META PER<br><em>${esc(nome)}</em></h1>
    <img class="hero" src="${ctx.img(d.blade)}" alt="">
    <div class="sub">${nuova ? `Primi podi dal ${dmy(d.firstSeen)}: ${d.topCut} top cut finora` : `${d.topCut} top cut negli ultimi 3 mesi, il ${pct(d.share)} del totale`}</div>
    ${foot(`${d.tournaments} tornei analizzati negli ultimi 3 mesi · dati al ${ctx.asOf}`)}`)];
  d.builds.forEach((b, i) => slides.push(comboSlide(ctx, `BUILD ${i + 1} DI ${d.builds.length} · ${b.type}`, b, period, `${d.tournaments} tornei analizzati`)));
  slides.push(wrap(`
    <div class="kicker">E LE ALTRE?</div>
    <h1>TUTTE LE COMBO<br>DI <em>${esc(nome)}</em><br>SUL SITO</h1>
    <div class="sub">Filtra per le parti che hai, vedi podi e trend di ogni combo.</div>
    <div class="url">beybladexcombos.com</div>
    ${foot('Salva il post · Scrivi la tua build nei commenti')}`));
  return slides;
}

function topBuildSlides(ctx: RenderCtx, c: PostCandidate): string[] {
  const d = c.data as { tournaments: number; combos: Build[] };
  const period = 'in un mese';
  return [
    wrap(`<div class="kicker">BEYBLADE X · META DELLA SETTIMANA</div>
      <h1>TOP 5<br>BUILD<br><em>DEL MOMENTO</em></h1>
      <div class="grid5">${d.combos.map((b) => `<img src="${ctx.img(b.blade)}" alt="">`).join('')}</div>
      <div class="sub">Le combo con più top cut nei tornei dell'ultimo mese</div>
      ${foot(`${d.tournaments} tornei analizzati in un mese · dati al ${ctx.asOf}`)}`),
    wrap(`<div class="kicker">CLASSIFICA · ULTIMO MESE</div>
      <ol>${d.combos.map((b, i) => `<li><span class="pos">${i + 1}</span><img src="${ctx.img(b.blade)}" alt=""><span class="nm">${esc(b.name)}</span><span class="pd">${b.topCut} top cut</span></li>`).join('')}</ol>
      ${foot('Top cut = podio o fase finale nei tornei WBO e MetaBeys')}`),
    ...d.combos.slice(0, 3).map((b, i) => comboSlide(ctx, `#${i + 1} DEL MESE · ${b.type}`, b, period, `${d.tournaments} tornei analizzati`)),
    wrap(`<div class="kicker">LE ALTRE?</div>
      <h1>TUTTA LA<br>CLASSIFICA<br><em>SUL SITO</em></h1>
      <div class="sub">Filtra per periodo, per parti che hai, per stadio.</div>
      <div class="url">beybladexcombos.com</div>
      ${foot('Salva il post · La tua build è in classifica? Scrivilo nei commenti')}`),
  ];
}

function topBladesSlides(ctx: RenderCtx, c: PostCandidate): string[] {
  const d = c.data as { tournaments: number; totalTopCut: number; blades: { blade: string; topCut: number; share: number; bestCombo: string }[] };
  return [
    wrap(`<div class="kicker">BEYBLADE X · META DELLA SETTIMANA</div>
      <h1>TOP 5<br>LAME<br><em>DEL MOMENTO</em></h1>
      <div class="grid5">${d.blades.map((b) => `<img src="${ctx.img(b.blade)}" alt="">`).join('')}</div>
      <div class="sub">Le lame con più top cut nei tornei dell'ultimo mese</div>
      ${foot(`${d.tournaments} tornei analizzati in un mese · dati al ${ctx.asOf}`)}`),
    wrap(`<div class="kicker">CLASSIFICA · ULTIMO MESE · ${d.totalTopCut} TOP CUT</div>
      <ol>${d.blades.map((b, i) => `<li><span class="pos">${i + 1}</span><img src="${ctx.img(b.blade)}" alt=""><span class="nm">${esc(ctx.name(b.blade))}</span><span class="pd">${b.topCut} · ${pct(b.share)}</span></li>`).join('')}</ol>
      ${foot('Quota = top cut della lama sul totale del mese')}`),
    wrap(`<div class="kicker">LA BUILD PIÙ FORTE DI OGNUNA</div>
      <ol>${d.blades.map((b, i) => `<li><span class="pos">${i + 1}</span><img src="${ctx.img(b.blade)}" alt=""><span class="nm">${esc(b.bestCombo)}</span></li>`).join('')}</ol>
      ${foot('Tutte le build di ogni lama sul sito')}`),
    wrap(`<div class="kicker">LE ALTRE?</div>
      <h1>TUTTE LE<br>LAME<br><em>SUL SITO</em></h1>
      <div class="sub">Classifica completa, trend e le build di ognuna.</div>
      <div class="url">beybladexcombos.com</div>
      ${foot('Salva il post · Quale lama manca secondo te? Scrivilo nei commenti')}`),
  ];
}

function risingSlides(ctx: RenderCtx, c: PostCandidate): string[] {
  const d = c.data as { blade: string; tournaments: number; recent: number; prevMonthly: number; growth: number; share: number; leader: string; builds: Build[] };
  const nome = ctx.name(d.blade);
  return [
    wrap(`<div class="kicker">BEYBLADE X · DA TENERE D'OCCHIO</div>
      <h1>NUOVO<br>INGRESSO<br>NEL <em>META?</em></h1>
      <img class="hero" src="${ctx.img(d.blade)}" alt="">
      <div class="sub">${esc(nome)}: da ${it(d.prevMonthly, 1)} a ${d.recent} top cut al mese</div>
      ${foot(`${d.tournaments} tornei analizzati in un mese · dati al ${ctx.asOf}`)}`),
    wrap(`<div class="kicker">${esc(nome)} · PRESENZA NEI TOP CUT</div>
      <div class="bigrow"><div><div class="big dim">${it(d.prevMonthly, 1)}</div><div class="lbl">AL MESE, PRIMA</div></div><div class="arrow">→</div><div><div class="big">${d.recent}</div><div class="lbl">ULTIMI 30 GIORNI</div></div></div>
      <div class="sub">${pct(d.share)} dei top cut del mese. Ancora poco rispetto a ${esc(ctx.name(d.leader))}, ma la crescita è ×${it(d.growth, 1)}.</div>
      <div class="kicker" style="margin-top:56px">LE BUILD CHE LO PORTANO</div>
      <ol class="mini">${d.builds.slice(0, 3).map((b) => `<li><img src="${ctx.img(b.bit)}" alt=""><span class="nm">${esc(b.name)}</span><span class="pd">${b.topCut} top cut</span></li>`).join('')}</ol>
      ${foot('Top cut = podio o fase finale nei tornei WBO e MetaBeys')}`),
    comboSlide(ctx, `LA BUILD PIÙ USATA · ${d.builds[0].type}`, d.builds[0], 'in un mese', 'Provala e dimmi nei commenti come va'),
  ];
}

export function renderSlides(ctx: RenderCtx, c: PostCandidate): string[] {
  switch (c.type) {
    case 'top-build': return topBuildSlides(ctx, c);
    case 'top-lame': return topBladesSlides(ctx, c);
    case 'nuovo-ingresso': return risingSlides(ctx, c);
    default: return bladeBuildSlides(ctx, c);
  }
}

const TAGS = '#beybladex #beyblade #beybladeitalia #beybladecombo #beybladexmeta #beybladetournament';

/** Didascalia: italiano sopra, inglese sotto, hashtag in coda. */
export function renderCaption(ctx: RenderCtx, c: PostCandidate): string {
  const d = c.data as Record<string, any>;
  const site = 'beybladexcombos.com';
  let itTxt = '', enTxt = '';
  if (c.type === 'top-build') {
    const top = d.combos.map((b: Build, i: number) => `${i + 1}. ${b.name} (${b.topCut})`).join('\n');
    itTxt = `Le 5 combo con più top cut nei tornei dell'ultimo mese (${d.tournaments} tornei WBO e MetaBeys analizzati):\n${top}\nClassifica completa e filtri per le parti che hai su ${site}`;
    enTxt = `Top 5 combos by top cuts in last month's tournaments (${d.tournaments} WBO + MetaBeys events). Full ranking and filters on ${site}`;
  } else if (c.type === 'top-lame') {
    const top = d.blades.map((b: any, i: number) => `${i + 1}. ${ctx.name(b.blade)} (${b.topCut}, ${pct(b.share)})`).join('\n');
    itTxt = `Le 5 lame con più top cut nell'ultimo mese, con la quota sul totale (${d.totalTopCut} top cut in ${d.tournaments} tornei):\n${top}\nLe build migliori di ogni lama su ${site}`;
    enTxt = `Top 5 blades by top cuts in the last month (${d.totalTopCut} top cuts across ${d.tournaments} events). Best builds for each blade on ${site}`;
  } else if (c.type === 'nuovo-ingresso') {
    const nome = ctx.name(d.blade);
    itTxt = `${nome} sta entrando nel meta? Da ${it(d.prevMonthly, 1)} a ${d.recent} top cut al mese (×${it(d.growth, 1)}), il ${pct(d.share)} dei top cut degli ultimi 30 giorni. Le build che lo portano: ${d.builds.slice(0, 3).map((b: Build) => `${b.name} (${b.topCut})`).join(', ')}.\nTutte le combo su ${site}`;
    enTxt = `Is ${nome} entering the meta? From ${it(d.prevMonthly, 1)} to ${d.recent} top cuts per month (×${it(d.growth, 1)}). Builds on ${site}`;
  } else {
    const nome = ctx.name(d.blade);
    const builds = d.builds.map((b: Build, i: number) => `${i + 1}. ${b.name} (${b.topCut} top cut)`).join('\n');
    itTxt = `Le build meta per ${nome}, dai risultati dei tornei${c.type === 'build-lama-nuova' ? ` (primi podi dal ${dmy(d.firstSeen)})` : ' degli ultimi 3 mesi'}:\n${builds}\nTutte le combo di ${nome} su ${site}`;
    enTxt = `Meta builds for ${nome}, from tournament results (${d.tournaments} events). All ${nome} combos on ${site}`;
  }
  return `${itTxt}\n\n${enTxt}\n\n${TAGS}`.slice(0, 2200);
}
