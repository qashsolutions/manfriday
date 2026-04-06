"use client";

export type Provider = "anthropic" | "openai" | "gemini";

interface ProviderSelectorProps {
  selected: Provider;
  onChange: (provider: Provider) => void;
}

const providers: { value: Provider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
];

export default function ProviderSelector({ selected, onChange }: ProviderSelectorProps) {
  return (
    <div className="flex rounded-lg border border-surface-3 overflow-hidden">
      {providers.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`
            flex-1 px-4 py-2 text-sm font-medium transition-colors
            ${
              selected === p.value
                ? "bg-accent text-white"
                : "bg-surface-2 text-gray-400 hover:text-white hover:bg-surface-3"
            }
          `}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
