/** The option card (DESIGN.md §8) — the shared molecule for every decision the
    creator makes. Decisions ship as 2–3 typed choices, never one order: a type
    badge, an effort tag, the choice in one plain sentence, why it's being put
    to them, then the receipts the confidence rests on — and one action row the
    caller owns (log it, or, on the Desk, apply it).

    Effort tags (DESIGN.md §8): minimal edit · re-cut · format change ·
    next upload · new video. */

import { ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";

export type OptionType = "safe" | "reach" | "bold";

/** The typed-choice vocabulary, matching the pills already shipped on the
    packaging and comparison screens. */
export const OPTION_BADGE: Record<OptionType, { label: string; cls: string }> = {
  safe: { label: "The safe bet", cls: "good" },
  reach: { label: "The smart reach", cls: "acc" },
  bold: { label: "The bold swing", cls: "warn" },
};

export function OptionCard({
  type,
  effort,
  choice,
  why,
  confidence,
  evidence,
  children,
}: {
  type?: OptionType | null;
  /** What it costs the creator to do this — always a real cost, never a guess. */
  effort?: string | null;
  /** The choice, in one plain-English sentence. */
  choice: string;
  /** Why this one is on the table — its revelation, not a tip. */
  why?: React.ReactNode;
  confidence?: number | null;
  evidence?: EvidenceItem[] | null;
  /** The action row: one button, or the state it lands in once taken. */
  children?: React.ReactNode;
}) {
  const badge = type ? OPTION_BADGE[type] : null;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "grid", gap: 8 }}>
      {(badge || effort) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {badge && <span className={`pill ${badge.cls}`}>{badge.label}</span>}
          {effort && <span className="pill mut">{effort}</span>}
        </div>
      )}
      <b style={{ fontSize: 13.5, lineHeight: 1.45 }}>{choice}</b>
      {why && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.55 }}>{why}</div>}
      {(confidence !== null && confidence !== undefined) && <ConfidenceBar value={confidence} />}
      {evidence?.length ? <EvidenceChips items={evidence} /> : null}
      {children}
    </div>
  );
}
