export function Bolt({ size = 20, color = "var(--accent)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill={color} />
    </svg>
  );
}

export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="display"
      style={{ fontSize: size, fontWeight: 900, letterSpacing: "0.04em" }}
    >
      MAN FRIDAY
    </span>
  );
}
