"use client";

interface Topic {
  topic: string;
  count: number;
}

interface MemoryInspectorProps {
  topics: Topic[];
  episodeCount: number;
}

export default function MemoryInspector({ topics, episodeCount }: MemoryInspectorProps) {
  const sorted = [...topics].sort((a, b) => b.count - a.count);
  const maxCount = sorted.length > 0 ? sorted[0].count : 1;

  return (
    <div className="border border-surface-3 bg-surface-2 rounded-lg p-5">
      {/* Episode count stat */}
      <div className="mb-5">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
          Total Episodes
        </div>
        <div className="text-3xl font-bold text-gray-100 tabular-nums">
          {episodeCount.toLocaleString()}
        </div>
      </div>

      {/* Topic bar chart */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Active Topics</h3>
        {sorted.length === 0 ? (
          <p className="text-xs text-gray-500">No topics recorded.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map(({ topic, count }) => (
              <li key={topic}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-gray-300 truncate mr-2" title={topic}>
                    {topic}
                  </span>
                  <span className="text-gray-500 tabular-nums shrink-0">{count}</span>
                </div>
                <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
