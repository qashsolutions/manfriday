/** Scorekeeper visuals: the verdict chip, the before→after receipt and the
    confidence pieces. */

/** What kind of claim a verdict is allowed to make — mirrors the
    `recommendations.verdict_kind` column (migration 17). */
export type VerdictKind = "viewers_stayed" | "head_to_head" | "what_happened" | "too_early";
export type VerdictValue = "worked" | "failed" | "mixed" | "unclear";
export type Chip = {
  cls: "good" | "warn" | "crit" | "mut";
  label: string;
  /** True when the result came from the creator telling us, not from a
      measurement — the chip is never allowed to stand alone in that case. */
  reported?: boolean;
};

/** A row written before kinds existed was judged on view counts alone, so it
    is read as the weakest claim it could be making — never upgraded, never
    dropped. One source for every surface that renders a stored verdict. */
export function kindOf(rec: { verdict: VerdictValue | null; verdict_kind: VerdictKind | null }): VerdictKind | null {
  if (rec.verdict_kind) return rec.verdict_kind;
  if (rec.verdict === "unclear") return "too_early";
  return rec.verdict ? "what_happened" : null;
}

/** Measured on real viewers, or by YouTube's own test — the two kinds whose
    result can be called a result. */
export const isMeasured = (k: VerdictKind | null) => k === "viewers_stayed" || k === "head_to_head";

/** The verdict chip (DESIGN.md §7, extended 2026-08-07): four states, one per
    kind of claim the numbers actually support.

    Colour is earned. A measured result — viewers staying longer, or YouTube's
    own test — gets a semantic colour. A views-only move never does, however
    big it is, because a channel's views swing on their own; it reads as an
    observation in neutral ink. Honesty about thin numbers is not a warning
    state, so "too early" is neutral too.

    A stored row with no kind is one written before kinds existed. Those were
    all computed from view counts, so they render as the weakest claim they
    could be making — never upgraded, never dropped. */
export function verdictChip(
  verdict: VerdictValue | null,
  kind: VerdictKind | null,
  opts?: { appliedDay?: number; judgeAfterDays?: number }
): Chip {
  // Resolved as too thin to call. How long it was watched is in the row's own
  // words — the chip doesn't claim a period it can't know for older rows.
  if (verdict === "unclear" || kind === "too_early") return { cls: "mut", label: "too early to judge" };
  if (verdict === null) {
    const day = opts?.appliedDay;
    const of = opts?.judgeAfterDays;
    return { cls: "mut", label: day && of ? `too early to judge — day ${day} of ${of}` : "too early to judge" };
  }
  if (kind === "viewers_stayed") {
    if (verdict === "worked") return { cls: "good", label: "✓ viewers stayed longer" };
    if (verdict === "failed") return { cls: "crit", label: "✕ viewers left sooner" };
    return { cls: "warn", label: "~ no real change in how long viewers stay" };
  }
  if (kind === "head_to_head") {
    if (verdict === "worked") return { cls: "good", label: "✓ YouTube's test picked this", reported: true };
    if (verdict === "failed") return { cls: "crit", label: "✕ YouTube's test picked another", reported: true };
    return { cls: "warn", label: "~ YouTube's test called it even", reported: true };
  }
  // what_happened, and every kindless row from before this existed.
  if (verdict === "worked") return { cls: "mut", label: "views up — what happened, not why" };
  if (verdict === "failed") return { cls: "mut", label: "views down — what happened, not why" };
  return { cls: "mut", label: "views held steady — what happened, not why" };
}

/** The chip as it ships: a creator-reported result always arrives with the
    words saying so, so it can never be mistaken for something we measured. */
export function VerdictChip({
  verdict,
  kind,
  appliedDay,
  judgeAfterDays,
}: {
  verdict: VerdictValue | null;
  kind: VerdictKind | null;
  appliedDay?: number;
  judgeAfterDays?: number;
}) {
  const chip = verdictChip(verdict, kind, { appliedDay, judgeAfterDays });
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span className={`pill ${chip.cls}`}>{chip.label}</span>
      {chip.reported && <span className="pill mut">you reported this</span>}
    </span>
  );
}

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
