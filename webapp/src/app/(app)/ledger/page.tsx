"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";
import { BeforeAfter, ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";
import { TEAM, sentenceCase } from "@/lib/team";

type Rec = {
  id: string;
  created_at: string;
  agent: string;
  category: string;
  recommendation: string;
  notes: string | null;
  status: "open" | "applied" | "skipped" | "resolved";
  verdict: "worked" | "failed" | "mixed" | "unclear" | null;
  baseline: { views_per_day?: number | null; view_count?: number | null } | null;
  result_snapshot: { metric?: string; before?: number; after?: number; ratio?: number; reason?: string; video_title?: string } | null;
  updates: { type: string; at?: string }[] | null;
  confidence: number | null;
  evidence: EvidenceItem[] | null;
};

const VERDICT_PILL: Record<string, { cls: string; label: string }> = {
  worked: { cls: "good", label: "✓ worked" },
  failed: { cls: "crit", label: "✕ didn't work" },
  mixed: { cls: "warn", label: "~ mixed" },
  unclear: { cls: "mut", label: "? too thin to judge" },
};

const JUDGE_AFTER_DAYS = 7;

function appliedDay(rec: Rec): number {
  const at = (rec.updates ?? []).find((u) => u.type === "applied")?.at;
  if (!at) return 1;
  return Math.max(1, Math.floor((Date.now() - Date.parse(at)) / 86_400_000) + 1);
}

export default function LedgerPage() {
  const supabase = supabaseBrowser();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("recommendations")
      .select("id,created_at,agent,category,recommendation,notes,status,verdict,baseline,result_snapshot,updates,confidence,evidence")
      .order("created_at", { ascending: false })
      .limit(100);
    setRecs((data as Rec[] | null) ?? []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(rec: Rec, status: "applied" | "skipped") {
    setBusyId(rec.id);
    const updates = status === "applied"
      ? [...(rec.updates ?? []), { type: "applied", at: new Date().toISOString() }]
      : (rec.updates ?? []);
    const { error } = await supabase.from("recommendations").update({ status, updates }).eq("id", rec.id);
    setBusyId(null);
    if (!error) await load();
  }

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
            <Explain
              why="Anyone can give advice; almost nobody checks whether it worked on your channel."
              how="Every tip snapshots your numbers before. Mark it applied, and the daily run compares after — verdicts land on their own about a week later."
              what="Ask an analyst for a read or a grade — the tips they log start the ledger."
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

          {recs.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--line2)", padding: "12px 2px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <b style={{ fontSize: 13.5 }}>{r.recommendation}</b>
                  <div className="sub" style={{ marginTop: 2 }}>
                    {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {" · "}{r.agent} · {r.category}
                  </div>
                  {r.notes && <div style={{ color: "var(--ink2)", fontSize: 12.5, marginTop: 4 }}>{r.notes}</div>}
                  {r.status === "open" && (r.evidence?.length || r.confidence !== null) && (
                    <div style={{ display: "grid", gap: 6, marginTop: 8, maxWidth: 460 }}>
                      {r.confidence !== null && <ConfidenceBar value={r.confidence} />}
                      {r.evidence && <EvidenceChips items={r.evidence} />}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {r.status === "open" && (
                    <>
                      <button className="btn btn-acc btn-sm" disabled={busyId === r.id} onClick={() => setStatus(r, "applied")}>
                        I applied this
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busyId === r.id} onClick={() => setStatus(r, "skipped")}>
                        Skip
                      </button>
                    </>
                  )}
                  {r.status === "applied" && (
                    <span className="pill acc" title={`${sentenceCase(TEAM.scorekeeper.name)} judges after ${JUDGE_AFTER_DAYS} days of fresh numbers`}>
                      ⏳ checking — day {Math.min(appliedDay(r), JUDGE_AFTER_DAYS)} of {JUDGE_AFTER_DAYS}
                    </span>
                  )}
                  {r.status === "skipped" && <span className="pill mut">skipped</span>}
                  {r.status === "resolved" && r.verdict && (
                    <span className={`pill ${VERDICT_PILL[r.verdict].cls}`}>
                      {VERDICT_PILL[r.verdict].label}
                      {r.result_snapshot?.ratio ? ` · ${r.result_snapshot.ratio}×` : ""}
                    </span>
                  )}
                </div>
              </div>

              {r.status === "resolved" && r.result_snapshot?.before !== undefined && r.result_snapshot?.after !== undefined && (
                <div style={{ marginTop: 10, maxWidth: 460 }}>
                  <BeforeAfter
                    before={r.result_snapshot.before!}
                    after={r.result_snapshot.after!}
                    unit={r.result_snapshot.metric === "views_per_day" ? "views/day" : "views"}
                  />
                  {r.result_snapshot.video_title && (
                    <div className="sub" style={{ marginTop: 4 }}>measured on &quot;{r.result_snapshot.video_title}&quot;</div>
                  )}
                </div>
              )}
              {r.status === "resolved" && r.verdict === "unclear" && r.result_snapshot?.reason && (
                <div className="sub" style={{ marginTop: 6 }}>{r.result_snapshot.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
