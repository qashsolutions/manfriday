"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";

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

  if (recs === null) return <div className="quiet">Loading…</div>;

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
          <div style={{ maxWidth: 460, margin: "18px auto 0", textAlign: "left" }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink3)", fontWeight: 700, marginBottom: 6 }}>
              Sample — how a checked tip reads
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "10px 12px", background: "var(--card)" }}>
              <b style={{ fontSize: 13 }}>Retitle the video to say what you get</b>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 12, color: "var(--ink2)", flexWrap: "wrap" }}>
                <span className="num">before: 41 views/day</span>
                <span>→</span>
                <span className="num">after: 128 views/day</span>
                <span className="pill good">✓ worked · 3×</span>
              </div>
            </div>
            <Explain
              why="Anyone can give advice; almost nobody checks whether it worked on your channel."
              how="Every tip snapshots your numbers before, then compares after you apply it."
              what="Apply a tip, and its verdict appears here on its own — good or bad."
            />
          </div>
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
          {counts.worked + counts.mixed + counts.failed > 0 && (
            <div style={{ margin: "0 2px 14px" }}>
              <div style={{ display: "flex", gap: 2, height: 10, borderRadius: 4, overflow: "hidden" }}>
                {counts.worked > 0 && <div style={{ flex: counts.worked, background: "var(--good)" }} title={`worked: ${counts.worked}`} />}
                {counts.mixed > 0 && <div style={{ flex: counts.mixed, background: "var(--warn)" }} title={`mixed: ${counts.mixed}`} />}
                {counts.failed > 0 && <div style={{ flex: counts.failed, background: "var(--crit)" }} title={`didn't work: ${counts.failed}`} />}
              </div>
              <Explain
                why="A team that hides its misses can't be trusted about its wins."
                how="Every checked tip, colored by its honest verdict — green worked, amber mixed, red didn't."
                what="If the red grows, tell us — the team stops repeating what fails on your channel."
              />
            </div>
          )}
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
