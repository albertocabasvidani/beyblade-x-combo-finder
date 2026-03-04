interface Props {
  score: number;
}

export function ScoreBadge({ score }: Props) {
  const color =
    score >= 9 ? 'text-green-400 bg-green-400/10 border-green-400/30' :
    score >= 8 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' :
    score >= 7 ? 'text-orange-400 bg-orange-400/10 border-orange-400/30' :
    'text-gray-400 bg-gray-400/10 border-gray-400/30';

  return (
    <span class={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}
