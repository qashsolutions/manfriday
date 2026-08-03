/** One-line why/how/what caption under a visual. Keep each part to a phrase. */
export function Explain({ why, how, what }: { why?: string; how?: string; what?: string }) {
  const Item = ({ label, text }: { label: string; text?: string }) =>
    text ? (
      <span style={{ marginRight: 16 }}>
        <b style={{ color: "var(--ink2)", fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</b>{" "}
        <span style={{ color: "var(--ink3)" }}>{text}</span>
      </span>
    ) : null;
  return (
    <div style={{ fontSize: 12, lineHeight: 1.7, marginTop: 10, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
      <Item label="Why" text={why} />
      <Item label="How" text={how} />
      <Item label="What now" text={what} />
    </div>
  );
}

/** Small horizontal ratio bar: this video vs the channel's normal (1.0×). */
export function RatioBar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span style={{ color: "var(--ink3)" }}>—</span>;
  const max = 3;
  const pct = Math.min(ratio, max) / max * 100;
  const color = ratio >= 2 ? "var(--good)" : ratio <= 0.5 ? "var(--crit)" : "var(--ink3)";
  const normalPct = (1 / max) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
      <div style={{ position: "relative", flex: 1, height: 6, borderRadius: 3, background: "var(--line2)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 3, background: color }} />
        <div title="your normal (1×)" style={{ position: "absolute", left: `${normalPct}%`, top: -2, bottom: -2, width: 2, background: "var(--ink3)", opacity: .6 }} />
      </div>
      <span className="num" style={{ fontSize: 11.5, color, width: 38, textAlign: "right" }}>{ratio}×</span>
    </div>
  );
}
