"use client";

export type SearchMode = "bm25" | "semantic" | "hybrid";

interface SearchModeSelectorProps {
  value: SearchMode;
  onChange: (mode: SearchMode) => void;
}

const MODES: { value: SearchMode; label: string; description: string }[] = [
  { value: "bm25", label: "Keyword", description: "BM25 term matching" },
  { value: "semantic", label: "Semantic", description: "pgvector embeddings" },
  { value: "hybrid", label: "Hybrid", description: "Combined ranking" },
];

export default function SearchModeSelector({ value, onChange }: SearchModeSelectorProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-300 mb-2">Search Mode</legend>
      <div className="flex gap-3">
        {MODES.map((mode) => (
          <label
            key={mode.value}
            className={`
              flex-1 cursor-pointer rounded-lg border p-3 transition-colors
              ${
                value === mode.value
                  ? "border-accent bg-accent/10 text-white"
                  : "border-surface-3 bg-surface-2 text-gray-400 hover:border-gray-500"
              }
            `}
          >
            <input
              type="radio"
              name="search-mode"
              value={mode.value}
              checked={value === mode.value}
              onChange={() => onChange(mode.value)}
              className="sr-only"
            />
            <span className="block text-sm font-semibold">{mode.label}</span>
            <span className="block text-xs text-gray-500 mt-0.5">{mode.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
