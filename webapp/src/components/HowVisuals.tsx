/** Mini-diagrams for the two steps and the score — each shows what the team
    does at that step, drawn with the app's tokens so they read as the product,
    not clip-art. No numbers appear in them: nothing here can be mistaken for
    a claim about anyone's channel. */

/** Step 1 · Why — your videos against your normal: one above it, one below. */
export function VizWhy() {
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

/** Step 2 · Next — three options, you pick one. */
export function VizNext() {
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
      <path d="M170 12 h30" stroke="var(--ink3)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="3 4" />
    </svg>
  );
}

/** The Score — what your views did before the pick and after it, stamped.
    The pair on the left is the verdict that landed; the pair on the right is
    the one that didn't. Bars carry no scale — the shape is the point. */
export function VizScore() {
  return (
    <svg viewBox="0 0 220 96" width="220" height="96" fill="none" aria-hidden>
      {/* worked: before → after, taller after */}
      <rect x="22" y="56" width="18" height="26" rx="4" fill="var(--line)" />
      <rect x="46" y="26" width="18" height="56" rx="4" fill="var(--good)" />
      <path d="M40 50 h4" stroke="var(--ink3)" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="20" y="6" width="46" height="16" rx="8" fill="var(--good-soft)" />
      <text x="28" y="17.5" fontSize="9" fontWeight="800" fill="var(--good)" fontFamily="inherit">✓ worked</text>

      {/* didn't: before → after, unchanged */}
      <rect x="140" y="50" width="18" height="32" rx="4" fill="var(--line)" />
      <rect x="164" y="51" width="18" height="31" rx="4" fill="var(--crit)" />
      <rect x="136" y="6" width="60" height="16" rx="8" fill="var(--crit-soft)" />
      <text x="144" y="17.5" fontSize="9" fontWeight="800" fill="var(--crit)" fontFamily="inherit">✕ didn&apos;t</text>

      <line x1="104" y1="14" x2="104" y2="86" stroke="var(--line)" strokeWidth="1.4" strokeDasharray="3 5" />
    </svg>
  );
}
