"use client";

export type RetentionPoint = { x: number; watch: number; rel: number | null };
export type RetentionDrop = { x: number; delta: number };

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Real audience-retention curve. Blue = this video; drops marked and listed.
    Renders with CSS tokens so it works in both themes. */
export function RetentionChart({
  points, drops, durationSeconds,
}: { points: RetentionPoint[]; drops: RetentionDrop[]; durationSeconds: number | null }) {
  if (points.length < 2) return null;

  const W = 860, H = 240, L = 52, R = 12, T = 16, B = 30;
  const plotW = W - L - R, plotH = H - T - B;
  const yMax = 1.0;
  const px = (x: number) => L + x * plotW;
  const py = (w: number) => T + (1 - Math.min(w, yMax) / yMax) * plotH;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.watch).toFixed(1)}`)
    .join(" ");

  const xLabel = (x: number) =>
    durationSeconds ? mmss(x * durationSeconds) : `${Math.round(x * 100)}%`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Share of viewers still watching across the video, with the steepest drops marked">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={py(g)} y2={py(g)} stroke="var(--line2)" />
            <text x={L - 6} y={py(g) + 3.5} textAnchor="end" style={{ fontSize: 9.5, fill: "var(--ink3)", fontFamily: "var(--mono)" }}>
              {Math.round(g * 100)}%
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((x) => (
          <text key={x} x={px(x)} y={H - 8} textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--ink3)", fontFamily: "var(--mono)" }}>
            {xLabel(x)}
          </text>
        ))}
        {drops.map((d, i) => (
          <g key={i}>
            <line x1={px(d.x)} x2={px(d.x)} y1={T} y2={T + plotH} stroke="var(--crit)" strokeDasharray="3 4" />
            <circle cx={px(d.x)} cy={py(points.find((p) => p.x >= d.x)?.watch ?? 0)} r={9} fill="var(--ink)" />
            <text x={px(d.x)} y={py(points.find((p) => p.x >= d.x)?.watch ?? 0) + 3.5} textAnchor="middle" style={{ fontSize: 10, fill: "var(--card)", fontWeight: 700 }}>
              {i + 1}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--acc)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {drops.length > 0 && (() => {
        // The list arrives in video order — find the genuinely steepest one, and
        // flag drops that fall off a spike above 100% (a counting blip at small
        // view numbers, not real viewers leaving).
        const steepestX = drops.reduce((a, b) => (b.delta > a.delta ? b : a)).x;
        const isBlip = (d: RetentionDrop) => {
          const idx = points.findIndex((p) => p.x >= d.x);
          const prev = idx > 0 ? points[idx - 1] : null;
          return (prev?.watch ?? 0) > 1 || d.delta > 1;
        };
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 10 }}>
            {drops.map((d, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "10px 12px" }}>
                <span style={{ display: "inline-flex", width: 20, height: 20, borderRadius: "50%", background: "var(--ink)", color: "var(--card)", fontSize: 11, fontWeight: 700, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>{i + 1}</span>
                <b style={{ display: "block", fontSize: 12.5 }}>
                  {durationSeconds ? `Around ${mmss(d.x * durationSeconds)}` : `At ${Math.round(d.x * 100)}% in`}
                </b>
                <span style={{ color: "var(--ink2)", fontSize: 12 }}>
                  {isBlip(d)
                    ? "The line spikes above 100% just before this — a counting blip at small view numbers, not a real exit."
                    : `−${Math.min(Math.round(d.delta * 100), 100)} pts of viewers in one step${d.x === steepestX ? " — your steepest loss" : ""}.`}
                </span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
