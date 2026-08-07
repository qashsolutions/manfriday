"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";
import { Receipt } from "@/components/Receipt";
import {
  BeforeAfter, ConfidenceBar, EvidenceChips, VerdictChip, isMeasured, kindOf,
  type EvidenceItem, type VerdictKind,
} from "@/components/Verdict";
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
  verdict_kind: VerdictKind | null;
  baseline: { views_per_day?: number | null; view_count?: number | null } | null;
  result_snapshot: {
    metric?: string; before?: number; after?: number; ratio?: number; reason?: string;
    video_title?: string; claim?: string; mark?: string; held_before?: number; held_after?: number;
    what_else_changed?: string[]; measured?: string;
  } | null;
  updates: { type: string; at?: string }[] | null;
  confidence: number | null;
  evidence: EvidenceItem[] | null;
};

const JUDGE_AFTER_DAYS = 7;

function appliedDay(rec: Rec): number {
  const at = (rec.updates ?? []).find((u) => u.type === "applied")?.at;
  if (!at) return 1;
  return Math.max(1, Math.floor((Date.now() - Date.parse(at)) / 86_400_000) + 1);
}

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** When they said they'd applied it — the day everything after is measured
    from. Older rows that predate the update trail fall back to written-on. */
const appliedOn = (rec: Rec): string =>
  (rec.updates ?? []).find((u) => u.type === "applied")?.at ?? rec.created_at;

export default function LedgerPage() {
  const supabase = supabaseBrowser();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which row's save failed, so the message lands on that row and no other. */
  const [errId, setErrId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("recommendations")
      .select("id,created_at,agent,category,recommendation,notes,status,verdict,verdict_kind,baseline,result_snapshot,updates,confidence,evidence")
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

  /** The creator ran YouTube's own Test & Compare and is telling us what it
      picked. YouTube measured it, the creator reported it — and every surface
      that shows the result says exactly that. */
  async function reportTestResult(rec: Rec, verdict: "worked" | "failed") {
    setBusyId(rec.id);
    setErrId(null);
    const at = new Date().toISOString();
    const claim =
      verdict === "worked"
        ? "YouTube's test — you reported the pick: its own test chose this one. YouTube decides that on watch time from real viewers, so this is the version it has already seen hold people longer. Keep it."
        : "YouTube's test — you reported the pick: its own test chose a different one. Keep the winner up, and ask the Marketer for a fresh set built on what beat you.";
    const { error } = await supabase
      .from("recommendations")
      .update({
        status: "resolved",
        verdict,
        verdict_kind: "head_to_head",
        resolved_at: at,
        result_snapshot: { measured: "reported", claim, reported_by: "creator", reported_at: at },
        updates: [...(rec.updates ?? []), { type: "verdict", at, verdict, kind: "head_to_head", reported: true }],
      })
      .eq("id", rec.id);
    setBusyId(null);
    if (error) {
      setErrId(rec.id);
      return;
    }
    await load();
  }

  if (recs === null) return <div className="quiet">Loading…</div>;

  const applied = recs.filter((r) => r.status === "applied" || r.status === "resolved").length;
  const measured = { worked: 0, mixed: 0, failed: 0 };
  const watched = { up: 0, steady: 0, down: 0 };
  let tooEarly = 0;
  for (const r of recs) {
    if (r.status !== "resolved") continue;
    const k = kindOf(r);
    if (k === "too_early") { tooEarly++; continue; }
    if (isMeasured(k)) {
      if (r.verdict === "worked") measured.worked++;
      else if (r.verdict === "mixed") measured.mixed++;
      else if (r.verdict === "failed") measured.failed++;
    } else {
      if (r.verdict === "worked") watched.up++;
      else if (r.verdict === "failed") watched.down++;
      else if (r.verdict === "mixed") watched.steady++;
    }
  }
  const measuredTotal = measured.worked + measured.mixed + measured.failed;
  const watchedTotal = watched.up + watched.steady + watched.down;

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
          Scorekeeper checks the numbers and calls it: viewers stayed longer, or they didn&apos;t, or
          the numbers can only show what happened and not why. Misses included. Advice that never
          gets checked is just a horoscope.
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
              [String(measuredTotal), "measured on viewers"],
              [String(watchedTotal), "watched on views"],
              [String(tooEarly), "too early to judge"],
            ].map(([n, label]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{n}</span>
                <span style={{ fontSize: 11, color: "var(--ink3)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 700 }}>{label}</span>
              </div>
            ))}
          </div>

          <div style={{ margin: "0 2px 14px" }}>
            {measuredTotal > 0 ? (
              <div style={{ display: "flex", gap: 2, height: 10, borderRadius: 4, overflow: "hidden" }}>
                {measured.worked > 0 && <div style={{ flex: measured.worked, background: "var(--good)" }} title={`viewers stayed longer: ${measured.worked}`} />}
                {measured.mixed > 0 && <div style={{ flex: measured.mixed, background: "var(--warn)" }} title={`no real change: ${measured.mixed}`} />}
                {measured.failed > 0 && <div style={{ flex: measured.failed, background: "var(--crit)" }} title={`viewers left sooner: ${measured.failed}`} />}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
                Nothing measured on viewers yet.{" "}
                {watchedTotal > 0
                  ? `${watchedTotal} ${watchedTotal === 1 ? "move was" : "moves were"} watched on views alone — which shows what happened, not why.`
                  : "Retention fixes on a video are the ones that get measured — pick one and the curve does the judging."}
              </p>
            )}
            <Explain
              why="A team that hides its misses can't be trusted about its wins — and a view count that tripled on its own isn't a win."
              how="Green, amber and red are only for results measured on real viewers: your retention curve, or YouTube's own test. Moves we could only watch on views stay in plain ink."
              what="If the red grows, tell us — the team stops repeating what fails on your channel."
            />
          </div>

          {recs.map((r) => {
            const kind = kindOf(r);
            const claim = r.result_snapshot?.claim ?? null;
            const held = r.result_snapshot?.held_before !== undefined && r.result_snapshot?.held_after !== undefined;
            return (
              <div key={r.id} style={{ borderTop: "1px solid var(--line2)", padding: "12px 2px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <b style={{ fontSize: 13.5 }}>{r.recommendation}</b>
                    <div className="sub" style={{ marginTop: 2 }}>
                      {dayLabel(r.created_at)}
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
                    {/* The same neutral chip the Desk shows, with the clock in
                        it: waiting is the fourth state, not a placeholder. */}
                    {r.status === "applied" && (
                      <span title={`${sentenceCase(TEAM.scorekeeper.name)} judges after ${JUDGE_AFTER_DAYS} days of fresh numbers`}>
                        <VerdictChip
                          verdict={null}
                          kind={null}
                          appliedDay={Math.min(appliedDay(r), JUDGE_AFTER_DAYS)}
                          judgeAfterDays={JUDGE_AFTER_DAYS}
                        />
                      </span>
                    )}
                    {r.status === "skipped" && <span className="pill mut">skipped</span>}
                    {r.status === "resolved" && (
                      <VerdictChip verdict={r.verdict} kind={kind} judgeAfterDays={JUDGE_AFTER_DAYS} />
                    )}
                  </div>
                </div>

                {/* YouTube's own test beats anything we can measure from outside —
                    but only the creator can see its result, so only they can
                    report it, and the row says so wherever it shows up. */}
                {r.status === "applied" && r.category === "packaging" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <span className="sub">Ran YouTube&apos;s Test &amp; Compare on this title or thumbnail?</span>
                    <button className="btn btn-ghost btn-sm" disabled={busyId === r.id} onClick={() => reportTestResult(r, "worked")}>
                      It picked this one
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={busyId === r.id} onClick={() => reportTestResult(r, "failed")}>
                      It picked another
                    </button>
                  </div>
                )}
                {errId === r.id && (
                  <div className="err" style={{ marginTop: 6 }}>
                    Couldn&apos;t put that on the record just now — try again in a moment.
                  </div>
                )}

                {r.status === "resolved" && (
                  <div style={{ marginTop: 10, maxWidth: 520, display: "grid", gap: 8 }}>
                    {claim && (
                      <Receipt
                        provenance={
                          kind === "head_to_head"
                            ? "YouTube's test — you reported the pick"
                            : kind === "viewers_stayed"
                              ? `how long viewers stayed · before and after · ${dayLabel(appliedOn(r))}`
                              : kind === "too_early"
                                ? "your own numbers · still too thin to call"
                                : `your views · since you applied it on ${dayLabel(appliedOn(r))}`
                        }
                        tone={kind === "viewers_stayed" || kind === "head_to_head"
                          ? (r.verdict === "worked" ? "good" : r.verdict === "failed" ? "crit" : "warn")
                          : "mut"}
                      >
                        {claim}
                      </Receipt>
                    )}
                    {held && (
                      <>
                        {/* The pair's unit column is narrow by design, so the
                            mark is named underneath rather than crammed in. */}
                        <BeforeAfter
                          before={r.result_snapshot!.held_before!}
                          after={r.result_snapshot!.held_after!}
                          unit="of 100"
                        />
                        <div className="sub">
                          viewers still watching at {r.result_snapshot!.mark ?? "the mark"}
                          {r.result_snapshot!.video_title ? ` on "${r.result_snapshot!.video_title}"` : ""}
                        </div>
                      </>
                    )}
                    {!held && r.result_snapshot?.before !== undefined && r.result_snapshot?.after !== undefined && (
                      <>
                        <BeforeAfter
                          before={r.result_snapshot.before!}
                          after={r.result_snapshot.after!}
                          unit={r.result_snapshot.metric === "views_per_day" ? "views/day" : "views"}
                        />
                        {r.result_snapshot.video_title && (
                          <div className="sub">measured on &quot;{r.result_snapshot.video_title}&quot;</div>
                        )}
                      </>
                    )}
                    {/* Rows from before the Scorekeeper wrote its reasoning down. */}
                    {!claim && r.verdict === "unclear" && r.result_snapshot?.reason && (
                      <div className="sub">{r.result_snapshot.reason}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
