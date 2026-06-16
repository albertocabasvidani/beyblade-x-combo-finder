interface Props {
  score: number;
  title?: string;
}

// Soglie allineate alla scala assoluta CAS (vedi src/lib/scoring.ts): meta ≥8.5, top-tier ≥7.
export function ScoreBadge({ score, title }: Props) {
  const color =
    score >= 8.5 ? 'text-green-400 bg-green-400/10 border-green-400/30' :
    score >= 7 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' :
    score >= 4 ? 'text-orange-400 bg-orange-400/10 border-orange-400/30' :
    'text-gray-400 bg-gray-400/10 border-gray-400/30';

  return (
    <span title={title} class={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}
