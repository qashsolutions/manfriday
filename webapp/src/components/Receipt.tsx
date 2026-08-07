/** The receipt (DESIGN.md §6) — the shared object every claim arrives pinned
    to. Three contents, one form: a viewer's words, a before→after pair, or a
    moment in the video. Paper-white block, a heavy left rule in the semantic
    color of what it proves, a mono provenance line on top (source · count ·
    date), the verbatim content at body size. Receipts never paraphrase.

    Tone is the semantic color of the claim: `acc` while a claim is open,
    `good`/`warn`/`crit` once the Scorekeeper has judged it. */

export type ReceiptTone = "acc" | "good" | "warn" | "crit" | "mut";

const RULE: Record<ReceiptTone, string> = {
  acc: "var(--acc)",
  good: "var(--good)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  mut: "var(--line)",
};

export function Receipt({
  provenance,
  tone = "acc",
  children,
}: {
  /** source · count · date — where this evidence came from. */
  provenance: string;
  tone?: ReceiptTone;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderLeft: `3px solid ${RULE[tone]}`,
        borderRadius: "0 12px 12px 0",
        padding: "12px 16px",
      }}
    >
      <div className="num" style={{ fontSize: 11.5, color: "var(--ink3)" }}>{provenance}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 4, color: "var(--ink)" }}>{children}</div>
    </div>
  );
}
