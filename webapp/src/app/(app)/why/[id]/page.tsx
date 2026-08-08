"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, fmtNum, type VideoPerf, type ChannelData } from "@/lib/channelData";
import { RetentionChart, type RetentionPoint, type RetentionDrop } from "@/components/RetentionChart";
import { Explain, WrongClaim } from "@/components/Explain";
import { ReadFailed, readFailed } from "@/components/ReadFailed";
import { Md } from "@/components/Md";
import { proseBuffer, readAnalystStream, Working } from "@/components/Working";
import { ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";
import { OptionCard, type OptionType } from "@/components/OptionCard";
import {
  DistributionSection, fmtDay,
  type DistributionOption, type DistributionRead,
} from "./DistributionSection";
import { TEAM, TEAM_ATTRIBUTION, agentNames, jobFor, sentenceCase } from "@/lib/team";

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

type WhyAction = {
  type?: OptionType | null;
  effort?: string | null;
  text: string;
  category: string;
  why: string;
  confidence: number;
  evidence: EvidenceItem[];
};
type WhyData = {
  verdict: string;
  reasons: { reason: string; evidence: string; agent: string }[];
  devils_advocate: string;
  actions?: WhyAction[];
  /** Verdicts written before 2026-08-07 carry ONE action instead of typed
      options. Stored rows are never rewritten (DESIGN.md §12), so they still
      have to render — as the single choice they were. */
  action?: WhyAction;
};
type WhyReport = { id: string; created_at: string; data: WhyData | null };

/** The team's next steps, whichever shape the row was written in. */
export function whyActions(d: WhyData): WhyAction[] {
  if (d.actions?.length) return d.actions;
  return d.action ? [d.action] : [];
}

/** Both the why-verdict and the distribution read are signed by the team (the
    roster is six — DESIGN.md §12), so the two are told apart by their shape. */
type TeamReport = { id: string; created_at: string; data: Record<string, unknown> | null };

/** Which of the team's rows belongs to which read. Taking the newest row alone
    would let whichever read was asked last hide the other from the screen. */
export function pickTeamReports(rows: TeamReport[]): { why: TeamReport | null; distribution: TeamReport | null } {
  return {
    why: rows.find((r) => r.data && "reasons" in r.data) ?? null,
    distribution: rows.find((r) => (r.data as { kind?: string } | null)?.kind === "distribution") ?? null,
  };
}

function storedDistribution(rep: TeamReport): DistributionRead {
  const d = (rep.data ?? {}) as Record<string, any>;
  return {
    state: d.state,
    reason: null,
    reasonKind: null,
    found: d.found ?? [],
    foundTotal: d.foundTotal ?? 0,
    change: d.change ?? null,
    windows: d.windows ?? null,
    checkBy: d.checkBy ?? null,
    analysis: {
      state: d.state,
      verdict: d.verdict ?? "",
      where_from: d.where_from ?? "",
      what_changed: d.what_changed ?? null,
      control_test: d.control_test ?? null,
      steady_note: d.steady_note ?? null,
      options: d.options ?? [],
    },
    createdAt: rep.created_at,
  };
}

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
  const [askStages, setAskStages] = useState<string[]>([]);
  const [askProse, setAskProse] = useState("");
  const [whyStages, setWhyStages] = useState<string[]>([]);
  const [whyProse, setWhyProse] = useState("");
  const [distRead, setDistRead] = useState<DistributionRead | null>(null);
  const [distAsking, setDistAsking] = useState(false);
  const [distErr, setDistErr] = useState<string | null>(null);
  const [distStages, setDistStages] = useState<string[]>([]);
  const [distProse, setDistProse] = useState("");

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
      .eq("video_id", v.id).in("agent", agentNames(TEAM.editor))
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data: reps }: { data: AnalystReport[] | null }) => {
        setReport(reps?.[0] ?? null);
        setReportLoaded(true);
      });
    // Fixes already in the Ledger for this video — so "log it" doesn't double up.
    supabase.from("recommendations").select("recommendation")
      .in("agent", [...agentNames(TEAM.editor), ...agentNames(TEAM_ATTRIBUTION)]).eq("target_yt_id", v.yt_video_id)
      .then(({ data: recs }: { data: { recommendation: string }[] | null }) => {
        if (recs?.length) setLogged(new Set(recs.map((r) => r.recommendation)));
      });
    // The team signs two different reads on this page — the "why did it do
    // this" verdict and the distribution read — so one query fetches the
    // team's recent rows and each read claims its own by shape. Taking only
    // the newest row would let whichever was asked last hide the other.
    supabase.from("reports").select("id,created_at,data")
      .eq("video_id", v.id).in("agent", agentNames(TEAM_ATTRIBUTION)).not("data", "is", null)
      .order("created_at", { ascending: false }).limit(8)
      .then(({ data: reps }: { data: TeamReport[] | null }) => {
        const { why, distribution } = pickTeamReports(reps ?? []);
        if (why) setWhyReport(why as unknown as WhyReport);
        if (distribution) setDistRead(storedDistribution(distribution));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, params.id]);

  async function askAnalyst(ytVideoId: string) {
    setAskErr(null);
    setAsking(true);
    setAskProse("");
    setAskStages([`${sentenceCase(TEAM.editor.name)} is picking up this video…`]);
    const prose = proseBuffer((add) => setAskProse((p) => p + add));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ video: ytVideoId, transcript: transcript.trim() || undefined }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "The analyst couldn't finish the read.");
      }
      if (!r.body) throw new Error("The analyst couldn't finish the read.");

      let j: { report: AnalystReport } | null = null;
      for await (const ev of readAnalystStream<{ report: AnalystReport }>(r.body)) {
        if (ev.t === "stage") setAskStages((s) => [...s, ev.m]);
        else if (ev.t === "prose") prose.push(ev.d);
        else if (ev.t === "error") throw new Error(ev.error);
        else if (ev.t === "done") j = ev;
      }
      prose.flush();
      if (!j) throw new Error("The read stopped before it finished — try again.");
      setReport(j.report);
    } catch (e) {
      setAskProse("");
      setAskErr(e instanceof Error ? e.message : "The analyst couldn't finish the read.");
    } finally {
      setAsking(false);
    }
  }

  async function askWhy(ytVideoId: string) {
    setWhyErr(null);
    setWhyAsking(true);
    setWhyProse("");
    setWhyStages([`${sentenceCase(TEAM_ATTRIBUTION.name)} is pulling this video's numbers together…`]);
    const prose = proseBuffer((add) => setWhyProse((p) => p + add));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/why", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ video: ytVideoId }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "The team's read couldn't finish.");
      }
      if (!r.body) throw new Error("The team's read couldn't finish.");

      // Streaming also fixed the old gateway-timeout hazard here: the first
      // bytes now arrive in seconds, so there is no long silence to time out.
      let j: { report: { id: string; created_at: string }; analysis: WhyData } | null = null;
      for await (const ev of readAnalystStream<{ report: { id: string; created_at: string }; analysis: WhyData }>(r.body)) {
        if (ev.t === "stage") setWhyStages((s) => [...s, ev.m]);
        else if (ev.t === "prose") prose.push(ev.d);
        else if (ev.t === "error") throw new Error(ev.error);
        else if (ev.t === "done") j = ev;
      }
      prose.flush();
      if (!j?.report) throw new Error("The team's read stopped before it finished — try again.");
      setWhyReport({ id: j.report.id, created_at: j.report.created_at, data: j.analysis ?? null });
    } catch (e) {
      setWhyProse("");
      setWhyErr(e instanceof Error ? e.message : "The team's read couldn't finish.");
    } finally {
      setWhyAsking(false);
    }
  }

  /** The distribution read: how viewers found this video, and — when the way in
      changed — whether that was the video or how YouTube spread it. */
  async function askDistribution(ytVideoId: string) {
    setDistErr(null);
    setDistAsking(true);
    setDistProse("");
    setDistStages([`${sentenceCase(TEAM_ATTRIBUTION.name)} is pulling up how viewers found this one…`]);
    const prose = proseBuffer((add) => setDistProse((p) => p + add));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/distribution", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ video: ytVideoId }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "The team's read couldn't finish.");
      }
      if (!r.body) throw new Error("The team's read couldn't finish.");

      type Done = DistributionRead & { report: { id: string; created_at: string } | null };
      let j: Done | null = null;
      for await (const ev of readAnalystStream<Done>(r.body)) {
        if (ev.t === "stage") setDistStages((s) => [...s, ev.m]);
        else if (ev.t === "prose") prose.push(ev.d);
        else if (ev.t === "error") throw new Error(ev.error);
        else if (ev.t === "done") j = ev;
      }
      prose.flush();
      if (!j) throw new Error("The read stopped before it finished — try again.");
      setDistRead({
        state: j.state,
        reason: j.reason,
        reasonKind: j.reasonKind,
        found: j.found,
        foundTotal: j.foundTotal,
        change: j.change,
        windows: j.windows,
        checkBy: j.checkBy,
        analysis: j.analysis,
        createdAt: j.report?.created_at ?? null,
      });
    } catch (e) {
      setDistProse("");
      setDistErr(e instanceof Error ? e.message : "The team's read couldn't finish.");
    } finally {
      setDistAsking(false);
    }
  }

  /** "I'll do this" → the pick lands in the Ledger with a before-number attached
      so the Scorekeeper can call the result later. */
  async function logFix(
    video: VideoPerf,
    f: {
      recommendation: string; category: string; expected: string; confidence: number; evidence: EvidenceItem[];
      /** Which typed choice they took — revealed preference every analyst reads back. */
      optionType?: OptionType | null;
      /** The day this pick is worth checking back on. The Ledger has no column
          for it, so it rides in the note where the creator already reads it. */
      checkBy?: string | null;
    },
    agent: string = TEAM.editor.name
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
      notes: f.checkBy
        ? `${f.expected} · check back on ${fmtDay(f.checkBy)} — that's when YouTube's numbers on a change like this have settled`
        : f.expected,
      confidence: Math.max(0, Math.min(100, Math.round(f.confidence))),
      evidence: f.evidence ?? [],
      option_type: f.optionType ?? null,
    });
    if (!error) setLogged((s) => new Set(s).add(f.recommendation));
  }

  /** A pick off the distribution read — same Ledger row shape as every other
      pick, so the Scorekeeper's arithmetic sees nothing new. */
  async function logDistributionPick(video: VideoPerf, o: DistributionOption, checkBy: string | null) {
    await logFix(video, {
      recommendation: o.text,
      category: o.category || "content",
      expected: o.why,
      confidence: o.confidence,
      evidence: o.evidence,
      optionType: o.type,
      checkBy,
    }, TEAM_ATTRIBUTION.name);
  }

  if (!data) return <div className="quiet">Loading…</div>;
  // Before "video not found": a failed read has no videos to find (§ReadFailed).
  if (readFailed(data)) return <ReadFailed onRetry={() => { setData(null); loadChannelData().then(setData); }} />;

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
        {whyAsking && !whyReport ? (
          <div style={{ marginTop: 10 }}>
            <Working stages={whyStages} />
            {whyProse && (
              <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}>
                <Md md={whyProse} />
              </div>
            )}
          </div>
        ) : whyReport?.data ? (
          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            <Md md={whyReport.data.verdict} />
            <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
              {whyReport.data.reasons.map((r, i) => (
                <li key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>
                  <b>{r.reason}</b>{" "}
                  <span style={{ color: "var(--ink2)" }}>— {r.evidence}</span>{" "}
                  <span className="sub" title={jobFor(r.agent)} style={{ whiteSpace: "nowrap" }}>{r.agent}</span>
                </li>
              ))}
            </ol>
            <div className="aside-note">
              <b>Playing devil&apos;s advocate</b>
              {whyReport.data.devils_advocate}
            </div>
            {whyActions(whyReport.data).length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                <span className="k">What to do next — you pick what lands in your Ledger</span>
                <div style={{ display: "grid", gap: 10, maxWidth: 620 }}>
                  {whyActions(whyReport.data).map((a, i) => (
                    <OptionCard
                      key={i}
                      type={a.type ?? null}
                      effort={a.effort ?? null}
                      choice={a.text}
                      why={a.why}
                      confidence={a.confidence}
                      evidence={a.evidence}
                    >
                      <div>
                        {logged.has(a.text) ? (
                          <span className="pill good">✓ in your Ledger — {TEAM.scorekeeper.name} will check it</span>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => v && logFix(v, {
                              recommendation: a.text,
                              category: a.category,
                              expected: a.why,
                              confidence: a.confidence,
                              evidence: a.evidence,
                              optionType: a.type ?? null,
                            }, TEAM_ATTRIBUTION.name)}
                          >
                            I&apos;ll do this — log it
                          </button>
                        )}
                      </div>
                    </OptionCard>
                  ))}
                </div>
              </div>
            )}
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

      <DistributionSection
        read={distRead}
        asking={distAsking}
        stages={distStages}
        prose={distProse}
        error={distErr}
        logged={logged}
        onAsk={() => v && askDistribution(v.yt_video_id)}
        onLog={(o, checkBy) => { if (v) void logDistributionPick(v, o, checkBy); }}
      />

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13.5 }}>Where viewers stop watching</h4>
          <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>
            <i style={{ display: "inline-block", width: 14, height: 3, borderRadius: 2, background: "var(--acc)", verticalAlign: 3, marginRight: 6 }} />
            share of viewers still watching
          </span>
        </div>

        {ret.state === "loading" && (
          <p className="quiet">{sentenceCase(TEAM.editor.name)} is reading how long viewers stayed…</p>
        )}
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
          <span className="k" title={TEAM.editor.job}>{sentenceCase(TEAM.editor.name)}&apos;s read — where viewers stop watching, and the fixes</span>
          {report && (
            <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
              written {new Date(report.created_at).toLocaleDateString()}
            </span>
          )}
        </div>

        {asking && !report ? (
          <div style={{ marginTop: 10 }}>
            <Working stages={askStages} />
            {askProse && (
              <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}>
                <Md md={askProse} />
              </div>
            )}
          </div>
        ) : report ? (
          <>
            {report.data ? (
              <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                <Md md={report.data.verdict} />
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
                              <span className="pill good">✓ in your Ledger — {TEAM.scorekeeper.name} will check it</span>
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
                  {asking ? "Reading the drops…" : `Ask ${TEAM.editor.name}`}
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
