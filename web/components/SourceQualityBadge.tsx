"use client";

interface SourceQualityBadgeProps {
  score: number; // 1-10
}

export default function SourceQualityBadge({ score }: SourceQualityBadgeProps) {
  const clamped = Math.max(1, Math.min(10, Math.round(score)));

  let colorClasses: string;
  if (clamped < 4) {
    colorClasses = "bg-red-500/15 text-red-400 border-red-500/30";
  } else if (clamped <= 6) {
    colorClasses = "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  } else {
    colorClasses = "bg-green-500/15 text-green-400 border-green-500/30";
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-semibold border ${colorClasses}`}
      title={`Source quality score: ${clamped}/10`}
    >
      {clamped}/10
    </span>
  );
}
