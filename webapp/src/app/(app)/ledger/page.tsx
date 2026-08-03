"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Rec = {
  id: string;
  created_at: string;
  agent: string;
  category: string;
  recommendation: string;
  status: "open" | "applied" | "skipped" | "resolved";
  verdict: "worked" | "failed" | "mixed" | "unclear" | null;
};

const VERDICT_PILL: Record<string, { cls: string; label: string }> = {
  worked: { cls: "good", label: "✓ worked" },
  failed: { cls: "crit", label: "✕ didn't work" },
  mixed: { cls: "warn", label: "~ mixed" },
  unclear: { cls: "mut", label: "? unclear" },
};

export default function LedgerPage() {
  const supabase = supabaseBrowser();
  const [recs, setRecs] = useState<Rec[] | null>(null);

  useEffect(() => {
    supabase
      .from("recommendations")
      .select("id,created_at,agent,category,recommendation,status,verdict")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }: { data: Rec[] | null }) => setRecs(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (recs === null) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;

  const applied = recs.filter((r) => r.status === "applied" || r.status === "resolved").length;
  const counts = { worked: 0, mixed: 0, failed: 0 };
  for (const r of recs) {
    if (r.verdict === "worked") counts.worked++;
    else if (r.verdict === "mixed") counts.mixed++;
    else if (r.verdict === "failed") counts.failed++;
  }

  return (
    <>
      <div className="pagehead">
        <h1>The Ledger</h1>
        <span className="byline" style={{ marginLeft: "auto" }}>
          <i />Every tip written down, then checked against what actually happened
        </span>
      </div>
      {recs.length === 0 ? (
        <div className="empty" style={{ padding: 40 }}>
          <b>Your ledger starts with your first tips</b>
          When the team gives you advice, it lands here as &quot;open&quot; — and once you apply it, the
          Scorekeeper checks the numbers and calls it honestly: worked, mixed, or didn&apos;t work.
          Misses included. Advice that never gets checked is just a horoscope.
        </div>
      ) : (
        <div className="card">
          <div style={{ display: "flex", gap: 26, padding: "4px 2px 14px", flexWrap: "wrap" }}>
            {[
              [String(recs.length), "tips given"],
              [String(applied), "applied"],
              [String(counts.worked), "worked"],
              [String(counts.mixed), "mixed"],
              [String(counts.failed), "didn't work"],
            ].map(([n, label]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{n}</span>
                <span style={{ fontSize: 11, color: "var(--ink3)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 700 }}>{label}</span>
              </div>
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {recs.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line2)" }}>
                  <td className="num" style={{ padding: "9px 10px 9px 0", color: "var(--ink3)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <b style={{ fontSize: 13 }}>{r.recommendation}</b>
                    <div style={{ color: "var(--ink3)", fontSize: 11.5 }}>{r.agent} · {r.category}</div>
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <span className={`pill ${r.status === "open" ? "acc" : "mut"}`}>{r.status}</span>
                  </td>
                  <td style={{ padding: "9px 0" }}>
                    {r.verdict
                      ? <span className={`pill ${VERDICT_PILL[r.verdict].cls}`}>{VERDICT_PILL[r.verdict].label}</span>
                      : <span className="pill mut">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
