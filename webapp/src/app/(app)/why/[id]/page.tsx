"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, fmtNum, type VideoPerf, type ChannelData } from "@/lib/channelData";
import { RetentionChart, type RetentionPoint, type RetentionDrop } from "@/components/RetentionChart";
import { Explain, WrongClaim } from "@/components/Explain";
import { Md } from "@/components/Md";
import { ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";
import { TEAM_LINES } from "@/lib/team";

type Retention =
  | { state: "loading" }
  | { state: "ready"; points: RetentionPoint[]; drops: RetentionDrop[] }
  | { state: "empty" }
  | { state: "unavailable"; reason: string };

type AnalystData = {
  verdict: string;
  drop_reads: { at: number; label: string; likely_cause: string; fix: string }[];
  fixes: { recommendation: string; category: string; effort?: string; expected: string; confidence: number; evidence: EvidenceItem[] }[];
  packaging_note: string | null;
};
type AnalystReport = { id: string; title: string; body_md: string; created_at: string; data: AnalystData | null };

type WhyData = {
  verdict: string;
  reasons: { reason: string; evidence: string; agent: string }[];
  devils_advocate: string;
  action: { text: string; category: string; why: string; confidence: number; evidence: EvidenceItem[] };
};
type WhyReport = { id: string; created_at: string; data: WhyData | null };

export default function WhyDetailPage() {
  const params = useParams<{ id: string }>();
  const supabase = supabaseBrowser();
  const [data, setData] = useState<ChannelData | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [ret, setRet] = useState<Retention>({ state: "loading" });
  const [report, setReport] = useState<AnalystReport | null>(null);
  const [reportLoaded, setReportLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [whyReport, setWhyReport] = useState<WhyReport | null>(null);
  const [whyAsking, setWhyAsking] = useState(false);
  const [whyErr, setWhyErr] = useState<string | null>(null);

  useEffect(() => { loadChannelData().then(setData); }, []);

  useEffect(() => {
    if (!data) return;
    const v = data.videos.find((x) => x.id === params.id || x.yt_video_id === params.id);
    if (!v) return;
    supabase.from("videos").select("duration_seconds").eq("id", v.id).maybeSingle()
      .then(({ data: d }: { data: { duration_seconds: number | null } | null }) => setDuration(d?.duration_seconds ?? null));
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const r = await fetch(`/api/analysis/retention?video=${encodeURIComponent(v.yt_video_id)}`, {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        if (r.status === 501) { setRet({ state: "unavailable", reason: "The connection service isn't configured on this deployment yet." }); return; }
        if (!r.ok) { setRet({ state: "unavailable", reason: "YouTube doesn't have retention data for this video (too new, too few views, or not on the connected channel)." }); return; }
        const j = await r.json();
        if (!j.points || j.points.length < 2) { setRet({ state: "empty" }); return; }
        setRet({ state: "ready", points: j.points, drops: j.drops ?? [] });
      } catch {
        setRet({ state: "unavailable", reason: "Couldn't reach the retention service." });
      }
    })();
    // Latest saved analyst read for this video (RLS: own rows only).
    supabase.from("reports").select("id,title,body_md,created_at,data")
      .eq("video_id", v.id).eq("agent", "Retention Analyst")
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data: reps }: { data: AnalystReport[] | null }) => {
        setReport(reps?.[0] ?? null);
        setReportLoaded(true);
      });
    // Fixes already in the Ledger for this video — so "log it" doesn't double up.
    supabase.from("recommendations").select("recommendation")
      .in("agent", ["Retention Analyst", "The Team"]).eq("target_yt_id", v.yt_video_id)
      .then(({ data: recs }: { data: { recommendation: string }[] | null }) => {
        if (recs?.length) setLogged(new Set(recs.map((r) => r.recommendation)));
      });
    // The team's latest "why did it do this" verdict for this video.
    supabase.from("reports").select("id,created_at,data")
      .eq("video_id", v.id).eq("agent", "The Team").not("data", "is", null)
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data: reps }: { data: WhyReport[] | null }) => {
        const rep = reps?.[0];
        if (rep?.data && "reasons" in (rep.data as object)) setWhyReport(rep);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, params.id]);

  async function askAnalyst(ytVideoId: string) {
    setAskErr(null);
    setAsking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ video: ytVideoId, transcript: transcript.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The analyst couldn't finish the read.");
      setReport(j.report);
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : "The analyst couldn't finish the read.");
    } finally {
      setAsking(false);
    }
  }

  async function askWhy(ytVideoId: string) {
    setWhyErr(null);
    setWhyAsking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/why", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ video: ytVideoId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The team's read couldn't finish.");
      setWhyReport({ id: j.report.id, created_at: j.report.created_at, data: j.analysis });
    } catch (e) {
      setWhyErr(e instanceof Error ? e.message : "The team's read couldn't finish.");
    } finally {
      setWhyAsking(false);
    }
  }

  /** "I'll do this" → the pick lands in the Ledger with a before-number attached
      so the Scorekeeper can call the result later. */
  async function logFix(
    video: VideoPerf,
    f: { recommendation: string; category: string; expected: string; confidence: number; evidence: EvidenceItem[] },
    agent: string = "Retention Analyst"
  ) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("recommendations").insert({
      user_id: user.id,
      agent,
      category: f.category || "retention",
      recommendation: f.recommendation,
      target_type: "video",
      target_yt_id: video.yt_video_id,
      baseline: {
        view_count: video.view_count,
        views_per_day: video.views_per_day,
        captured_at: new Date().toISOString(),
      },
      notes: f.expected,
      confidence: Math.max(0, Math.min(100, Math.round(f.confidence))),
      evidence: f.evidence ?? [],
    });
    if (!error) setLogged((s) => new Set(s).add(f.recommendation));
  }

  if (!data) return <div className="quiet">Loading…</div>;

  const v: VideoPerf | undefined = data.videos.find((x) => x.id === params.id || x.yt_video_id === params.id);
  if (!v) {
    return (
      <>
        <div className="pagehead"><h1>Video not found</h1></div>
        <Link className="btn btn-ghost" href="/why">Back to all videos</Link>
      </>
    );
  }

  const med = v.is_short ? data.baselines.shorts?.median_views : data.baselines.longform?.median_views;

  return (
    <>
      <div className="pagehead"><h1>{v.title ?? v.yt_video_id}</h1></div>
      <div style={{ marginBottom: 14, color: "var(--ink3)", fontSize: 12.5 }}>
        {v.published_at ? `Published ${new Date(v.published_at).toLocaleDateString()}` : ""}
        {v.is_short ? " · Short" : ""} ·{" "}
        <a href={`https://www.youtube.com/watch?v=${v.yt_video_id}`} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>
          watch on YouTube ↗
        </a>
      </div>

      <div className="grid g3">
        <div className="card stat">
          <span className="k">Views</span>
          <div className="big num">{fmtNum(v.view_count)}</div>
          <span className="delta fl num">{v.views_per_day ? `${fmtNum(v.views_per_day)} a day` : ""}</span>
        </div>
        <div className="card stat">
          <span className="k">Normal for this format</span>
          <div className="big num">{fmtNum(med ?? null)}</div>
          <span className="delta fl">{v.is_short ? "your typical Short" : "your typical full video"}</span>
        </div>
        <div className="card stat">
          <span className="k">Verdict so far</span>
          <div className="big" style={{ fontSize: 20 }}>
            {v.flag === "underperformer" ? "fell short"
              : v.flag === "outperformer" ? "did something right"
              : v.flag === "typical" ? "typical for you"
              : "too few views to judge"}
          </div>
          <span className={`delta ${v.flag === "underperformer" ? "dn" : v.flag === "outperformer" ? "up" : "fl"}`}>
            {fmtNum(v.view_count)} {v.view_count === 1 ? "view" : "views"} — your usual is {fmtNum(med ?? null)}
            {v.flag === null ? " · the reads below still work" : ""}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span className="k">Why this video did what it did — the team&apos;s verdict</span>
          {whyReport && (
            <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
              written {new Date(whyReport.created_at).toLocaleDateString()}
            </span>
          )}
        </div>
        {whyReport?.data ? (
          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>{whyReport.data.verdict}</p>
            <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
              {whyReport.data.reasons.map((r, i) => (
                <li key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>
                  <b>{r.reason}</b>{" "}
                  <span style={{ color: "var(--ink2)" }}>— {r.evidence}</span>{" "}
                  <span className="sub" title={TEAM_LINES[r.agent]} style={{ whiteSpace: "nowrap" }}>{r.agent}</span>
                </li>
              ))}
            </ol>
            <div className="aside-note">
              <b>Playing devil&apos;s advocate</b>
              {whyReport.data.devils_advocate}
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13, display: "grid", gap: 7, maxWidth: 560 }}>
              <span className="k">The one thing to do next</span>
              <b style={{ fontSize: 13 }}>{whyReport.data.action.text}</b>
              <div className="sub">{whyReport.data.action.why}</div>
              <ConfidenceBar value={whyReport.data.action.confidence} />
              <EvidenceChips items={whyReport.data.action.evidence} />
              <div>
                {logged.has(whyReport.data.action.text) ? (
                  <span className="pill good">✓ in your Ledger — Scorekeeper will check it</span>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => v && whyReport.data && logFix(v, {
                      recommendation: whyReport.data.action.text,
                      category: whyReport.data.action.category,
                      expected: whyReport.data.action.why,
                      confidence: whyReport.data.action.confidence,
                      evidence: whyReport.data.action.evidence,
                    }, "The Team")}
                  >
                    I&apos;ll do this — log it
                  </button>
                )}
              </div>
            </div>
            <div>
              <button className="btn btn-ghost btn-sm" onClick={() => v && askWhy(v.yt_video_id)} disabled={whyAsking}>
                {whyAsking ? "The team is arguing it out…" : "Ask again"}
              </button>
              {whyErr && <span className="err" style={{ marginLeft: 10, fontSize: 12.5 }}>{whyErr}</span>}
            </div>
          </div>
        ) : (
          <div className="grid g2" style={{ marginTop: 8, alignItems: "center" }}>
            <p style={{ margin: 0, color: "var(--ink2)", fontSize: 13, lineHeight: 1.6 }}>
              Catchy title? Search demand? The algorithm showed it around? Channel size? The team
              weighs where the views actually came from, calls the likely reasons — then argues
              against itself so you get the honest answer, not a flattering one.
            </p>
            <div>
              {whyErr && <div className="err" style={{ marginBottom: 10 }}>{whyErr}</div>}
              <button className="btn btn-acc" onClick={() => v && askWhy(v.yt_video_id)} disabled={whyAsking}>
                {whyAsking ? "The team is arguing it out…" : "Why did it do this? — ask the team"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13.5 }}>Where viewers stop watching</h4>
          <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>
            <i style={{ display: "inline-block", width: 14, height: 3, borderRadius: 2, background: "var(--acc)", verticalAlign: 3, marginRight: 6 }} />
            share of viewers still watching
          </span>
        </div>

        {ret.state === "loading" && <p style={{ color: "var(--ink3)", fontSize: 13 }}>Reading your retention curve…</p>}
        {ret.state === "ready" && (
          <>
            <RetentionChart points={ret.points} drops={ret.drops} durationSeconds={duration} />
            <Explain
              why="Views tell you the packaging worked; this curve tells you whether the video did."
              how="Your channel's real YouTube data — the same curve Studio shows, with the steepest losses found for you."
              what="Open the video at each marked moment and see what you were doing — that's what to change next time."
            />
          </>
        )}
        {ret.state === "empty" && (
          <p style={{ color: "var(--ink2)", fontSize: 13 }}>
            YouTube hasn&apos;t produced a retention curve for this video yet — it usually needs a few
            hundred views and a day or two.
          </p>
        )}
        {ret.state === "unavailable" && <p style={{ color: "var(--ink2)", fontSize: 13 }}>{ret.reason}</p>}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span className="k" title={TEAM_LINES["Retention Analyst"]}>The Retention Analyst&apos;s read — where viewers stop watching, and the fixes</span>
          {report && (
            <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
              written {new Date(report.created_at).toLocaleDateString()}
            </span>
          )}
        </div>

        {report ? (
          <>
            {report.data ? (
              <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>{report.data.verdict}</p>
                {report.data.drop_reads.length > 0 && (
                  <div className="grid g3" style={{ alignItems: "stretch" }}>
                    {report.data.drop_reads.map((d, i) => (
                      <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13 }}>
                        <span className="pill crit" style={{ fontSize: 10.5 }}>drop at {d.label}</span>
                        <p style={{ margin: "8px 0 6px", fontSize: 12.5, color: "var(--ink2)" }}>{d.likely_cause}</p>
                        <p style={{ margin: 0, fontSize: 12.5 }}><b>Fix:</b> {d.fix}</p>
                      </div>
                    ))}
                  </div>
                )}
                {report.data.packaging_note && (
                  <div className="aside-note"><b>About the packaging</b>{report.data.packaging_note}</div>
                )}
                {report.data.fixes.length > 0 && (
                  <div>
                    <span className="k">Fixes to pick from — you decide what lands in your Ledger</span>
                    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                      {report.data.fixes.map((f, i) => (
                        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13, display: "grid", gap: 7, maxWidth: 560 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <b style={{ fontSize: 13 }}>{f.recommendation}</b>
                            {f.effort && <span className="pill" style={{ fontSize: 10.5 }}>{f.effort}</span>}
                          </div>
                          <div className="sub">expect: {f.expected}</div>
                          <ConfidenceBar value={f.confidence} />
                          <EvidenceChips items={f.evidence} />
                          <div>
                            {logged.has(f.recommendation) ? (
                              <span className="pill good">✓ in your Ledger — Scorekeeper will check it</span>
                            ) : (
                              <button className="btn btn-ghost btn-sm" onClick={() => v && logFix(v, f)}>
                                I&apos;ll do this — log it
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 8 }}><Md md={report.body_md} /></div>
            )}
            <Explain
              why="A curve shows where viewers left; the analyst's job is the why and the fix."
              how="The drops above, your title and description, and your channel's normal — read together. You pick which fixes land in your Ledger."
              what="Log a fix you'll actually do, apply it on your next upload — the Scorekeeper calls the result honestly."
            />
            <WrongClaim context={`Retention read on "${v.title ?? v.yt_video_id}"`} />
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => v && askAnalyst(v.yt_video_id)} disabled={asking || ret.state !== "ready"}>
                {asking ? "Re-reading…" : "Ask again"}
              </button>
              {askErr && <span className="err" style={{ marginLeft: 10, fontSize: 12.5 }}>{askErr}</span>}
            </div>
          </>
        ) : (
          <div className="grid g2" style={{ marginTop: 8, alignItems: "start" }}>
            <p style={{ color: "var(--ink2)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
              The analyst matches each marked drop to what was happening in the video at that moment
              and offers fixes with expected outcomes — you pick which land in your Ledger, and the
              Scorekeeper checks them later. Fewer people leaving = more of your video watched =
              YouTube shows it to more people.
            </p>
            <div>
              <details>
                <summary style={{ fontSize: 12.5, color: "var(--acc)", cursor: "pointer" }}>
                  Add your script (optional) — quotes make the read sharper
                </summary>
                <textarea
                  className="input"
                  rows={4}
                  style={{ marginTop: 8, width: "100%", resize: "vertical", fontFamily: "inherit" }}
                  placeholder="Paste the script or transcript here…"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
              </details>
              {askErr && <div className="err" style={{ marginTop: 10 }}>{askErr}</div>}
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn btn-acc"
                  onClick={() => v && askAnalyst(v.yt_video_id)}
                  disabled={asking || !reportLoaded || ret.state !== "ready"}
                  title={ret.state !== "ready" ? "The analyst needs the retention curve above first" : undefined}
                >
                  {asking ? "Reading the drops…" : "Ask the Retention Analyst"}
                </button>
                {ret.state !== "ready" && ret.state !== "loading" && (
                  <span style={{ marginLeft: 10, fontSize: 12, color: "var(--ink3)" }}>
                    needs the retention curve above first
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
