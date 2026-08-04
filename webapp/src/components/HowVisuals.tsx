/** Mini-diagrams for the how-it-works flow — each shows the step's outcome,
    drawn with the app's tokens so they read as the product, not clip-art. */

/** Your channel linked to the team — read-only. */
export function VizConnect() {
  return (
    <svg viewBox="0 0 220 96" width="220" height="96" fill="none" aria-hidden>
      <rect x="10" y="26" width="64" height="44" rx="10" stroke="var(--ink3)" strokeWidth="1.6" />
      <path d="M36 40 L52 48 L36 56 Z" fill="var(--ink3)" />
      <path d="M80 48 H140" stroke="var(--acc)" strokeWidth="1.8" strokeDasharray="4 5" strokeLinecap="round" />
      <circle cx="110" cy="48" r="11" fill="var(--acc-soft)" stroke="var(--acc)" strokeWidth="1.6" />
      <path d="M105.5 48 l3 3 l6 -6" stroke="var(--acc)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="146" y="26" width="64" height="44" rx="10" stroke="var(--acc)" strokeWidth="1.8" />
      <rect x="158" y="44" width="24" height="6" rx="3" fill="var(--acc)" />
      <text x="158" y="62" fontSize="9" fontWeight="700" fill="var(--ink)" fontFamily="inherit">your team</text>
    </svg>
  );
}

/** Your normal appears — one bar above it, one below. */
export function VizBaseline() {
  return (
    <svg viewBox="0 0 220 96" width="220" height="96" fill="none" aria-hidden>
      {[
        { x: 26, h: 30 }, { x: 58, h: 40 }, { x: 90, h: 62, win: true },
        { x: 122, h: 36 }, { x: 154, h: 16, miss: true }, { x: 186, h: 42 },
      ].map((b, i) => (
        <rect
          key={i} x={b.x} y={84 - b.h} width="20" height={b.h} rx="4"
          fill={b.win ? "var(--good)" : b.miss ? "var(--crit)" : "var(--acc-line)"}
        />
      ))}
      <line x1="16" y1="46" x2="212" y2="46" stroke="var(--ink)" strokeWidth="1.4" strokeDasharray="5 4" />
      <text x="16" y="40" fontSize="9" fontWeight="700" fill="var(--ink)" fontFamily="inherit">your normal</text>
    </svg>
  );
}

/** Three options, you pick — the pick gets checked later. */
export function VizOptions() {
  return (
    <svg viewBox="0 0 220 96" width="220" height="96" fill="none" aria-hidden>
      {[
        { y: 12, w: 118, picked: true },
        { y: 42, w: 96 },
        { y: 72, w: 108 },
      ].map((r, i) => (
        <g key={i}>
          <rect x="14" y={r.y - 6} width="150" height="24" rx="7"
                stroke={r.picked ? "var(--acc)" : "var(--line)"} strokeWidth={r.picked ? 1.8 : 1.4}
                fill={r.picked ? "var(--acc-soft)" : "none"} />
          <circle cx="28" cy={r.y + 6} r="5" stroke={r.picked ? "var(--acc)" : "var(--ink3)"} strokeWidth="1.6"
                  fill={r.picked ? "var(--acc)" : "none"} />
          <rect x="40" y={r.y + 3} width={r.w - 36} height="6" rx="3" fill={r.picked ? "var(--acc)" : "var(--line)"} />
        </g>
      ))}
      <rect x="170" y="0" width="44" height="24" rx="7" fill="var(--good-soft)" />
      <text x="178" y="15" fontSize="10" fontWeight="800" fill="var(--good)" fontFamily="inherit">✓ 3×</text>
      <path d="M164 12 C168 12 168 12 171 12" stroke="var(--ink3)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
