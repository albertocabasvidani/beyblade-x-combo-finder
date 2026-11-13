/**
 * test-reddit-bd.ts — Golden test della conversione dei record Bright Data (scrape-reddit.ts).
 * Nessuna rete: i record sono costruiti sulla forma vista nella risposta vera del 13/11/2026.
 *
 * Uso: npx tsx scripts/test-reddit-bd.ts
 */
import { daRecord, parlaDiTorneo } from './scrape-reddit';

let falliti = 0;
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`${ok ? 'ok  ' : 'KO  '} ${nome}${ok ? '' : ` ${dettaglio}`}`);
  if (!ok) falliti++;
}

const record = {
  post_id: 't3_1xuykn1',
  url: 'https://www.reddit.com/r/Beyblade/comments/1xuykn1/almost_top_cut/',
  title: 'Almost top cut',
  description: 'Went 4-1 with Wizard Rod 1-60 Hexa and missed the cut on tiebreakers. Read more',
  num_upvotes: 8,
  date_posted: '2026-11-13T04:37:45.708Z',
  comments: [
    { comment: 'nice', replies: [{ reply: 'Shark Scale 3-60 Low Rush did great for me this weekend' }] },
    { comment: 'What bit did you run on the Wizard Rod in swiss?', replies: [] },
  ],
};

const p = daRecord(record)!;
check('id senza prefisso t3_', p.id === '1xuykn1', p.id);
check('Read more tolto dal testo', p.body.endsWith('tiebreakers.'), JSON.stringify(p.body.slice(-20)));
check('data a giorno', p.date === '2026-11-13', p.date);
check('voti', p.score === 8);
check('commenti corti scartati, risposte tenute', p.comments.length === 2 && p.comments[0].startsWith('Shark Scale'), JSON.stringify(p.comments));
check('post di torneo riconosciuto dal titolo', parlaDiTorneo(p));

const senzaId = daRecord({ url: 'https://x', title: 'a' });
check('record senza post_id scartato', senzaId === null);

const casi: [string, string, boolean][] = [
  ['BEYBLADE TOURNAMENTS FLORIDA', '', true],
  ['First locals', 'I won with Phoenix Wing', true],
  ['Local tourney report', '', true],
  ['Winning deck', '', true],
  ['Made top-cut', '', true],
  ['When and where can I pre-order this', '', false],
  ['Wonderful custom paint', 'it is wonderful', false],
  ['Is this a good combo', 'thinking of Dran Sword', false],
];
for (const [title, body, atteso] of casi) {
  const post = { id: 'x', title, body, url: 'u', score: 0, date: '', comments: [] };
  check(`filtro: «${title}» ${atteso ? 'passa' : 'resta fuori'}`, parlaDiTorneo(post) === atteso);
}

console.log(falliti ? `\n${falliti} controlli falliti` : '\nTutti i controlli passati');
process.exit(falliti ? 1 : 0);
