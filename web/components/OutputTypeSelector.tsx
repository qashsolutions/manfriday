"use client";

export type OutputType = "md" | "marp" | "chart" | "table";

interface OutputTypeSelectorProps {
  selected: OutputType;
  onChange: (type: OutputType) => void;
}

const options: { value: OutputType; label: string }[] = [
  { value: "md", label: "md" },
  { value: "marp", label: "marp" },
  { value: "chart", label: "chart" },
  { value: "table", label: "table" },
];

export default function OutputTypeSelector({ selected, onChange }: OutputTypeSelectorProps) {
  return (
    <div className="inline-flex rounded-lg border border-surface-3 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`
            px-3 py-1.5 text-xs font-mono font-medium transition-colors
            ${
              selected === opt.value
                ? "bg-accent text-white"
                : "bg-surface-2 text-gray-400 hover:text-white hover:bg-surface-3"
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
