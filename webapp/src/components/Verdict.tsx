/** Scorekeeper visuals: the before→after receipt and the confidence pieces. */

export function BeforeAfter({ before, after, unit }: { before: number; after: number; unit: string }) {
  const max = Math.max(before, after, 1);
  const bar = (v: number, color: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--line2)" }}>
        <div style={{ width: `${Math.max(4, (v / max) * 100)}%`, height: "100%", borderRadius: 4, background: color }} />
      </div>
      <span className="num" style={{ fontSize: 11.5, width: 84, textAlign: "right" }}>{v.toLocaleString()} {unit}</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 4, minWidth: 200, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="sub" style={{ width: 38 }}>before</span>
        <div style={{ flex: 1 }}>{bar(before, "var(--ink3)")}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="sub" style={{ width: 38 }}>after</span>
        <div style={{ flex: 1 }}>{bar(after, after >= before * 1.5 ? "var(--good)" : after <= before * 0.75 ? "var(--crit)" : "var(--warn)")}</div>
      </div>
    </div>
  );
}

/** Grounded 0-100 confidence as a sliding scale. */
export function ConfidenceBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 70 ? "var(--good)" : v >= 40 ? "var(--acc)" : "var(--warn)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="sub" style={{ width: 68 }}>confidence</span>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--line2)", position: "relative" }}>
        <div style={{ width: `${v}%`, height: "100%", borderRadius: 4, background: color }} />
        {[25, 50, 75].map((t) => (
          <span key={t} style={{ position: "absolute", left: `${t}%`, top: -1, bottom: -1, width: 1, background: "var(--card)" }} />
        ))}
      </div>
      <span className="num" style={{ fontSize: 11.5, color, width: 26, textAlign: "right", fontWeight: 700 }}>{v}</span>
    </div>
  );
}

export type EvidenceItem = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };

const EVIDENCE_STYLE: Record<EvidenceItem["kind"], { icon: string; cls: string }> = {
  ledger: { icon: "✓", cls: "good" },     // proven on this channel
  library: { icon: "★", cls: "acc" },     // pattern in their own winners
  search: { icon: "⌨", cls: "mut" },      // what people really type
  audience: { icon: "◎", cls: "acc" },    // fits who they're for
  caution: { icon: "⚠", cls: "warn" },    // honest limiter
};

export function EvidenceChips({ items }: { items: EvidenceItem[] }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((e, i) => {
        const s = EVIDENCE_STYLE[e.kind] ?? EVIDENCE_STYLE.caution;
        return <span key={i} className={`pill ${s.cls}`} style={{ fontSize: 11 }}>{s.icon} {e.label}</span>;
      })}
    </div>
  );
}
