"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, fmtNum, type VideoPerf, type ChannelData } from "@/lib/channelData";
import { RetentionChart, type RetentionPoint, type RetentionDrop } from "@/components/RetentionChart";
import { Explain } from "@/components/Explain";
import { Md } from "@/components/Md";

type Retention =
  | { state: "loading" }
  | { state: "ready"; points: RetentionPoint[]; drops: RetentionDrop[] }
  | { state: "empty" }
  | { state: "unavailable"; reason: string };

type AnalystReport = { id: string; title: string; body_md: string; created_at: string };

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
    supabase.from("reports").select("id,title,body_md,created_at")
      .eq("video_id", v.id).eq("agent", "Retention Analyst")
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data: reps }: { data: AnalystReport[] | null }) => {
        setReport(reps?.[0] ?? null);
        setReportLoaded(true);
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

  if (!data) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;

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
          <div className="big num">{v.ratio !== null ? `${v.ratio}×` : "—"}</div>
          {v.flag === "underperformer" && <span className="delta dn">well below your normal</span>}
          {v.flag === "outperformer" && <span className="delta up">a hit — worth studying</span>}
          {v.flag === "typical" && <span className="delta fl">about normal</span>}
          {v.flag === null && (
            <span className="delta fl">early days — verdicts unlock as your views grow</span>
          )}
        </div>
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
          <span className="k">The Retention Analyst&apos;s read</span>
          {report && (
            <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
              written {new Date(report.created_at).toLocaleDateString()}
            </span>
          )}
        </div>

        {report ? (
          <>
            <div style={{ marginTop: 8 }}><Md md={report.body_md} /></div>
            <Explain
              why="A curve shows where viewers left; the analyst's job is the why and the fix."
              how="The drops above, your title and description, and your channel's normal — read together. Fixes are logged to your Ledger and checked later."
              what="Apply a fix on your next upload — the Scorekeeper calls the result honestly."
            />
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => v && askAnalyst(v.yt_video_id)} disabled={asking || ret.state !== "ready"}>
                {asking ? "Re-reading…" : "Ask again"}
              </button>
              {askErr && <span className="err" style={{ marginLeft: 10, fontSize: 12.5 }}>{askErr}</span>}
            </div>
          </>
        ) : (
          <>
            <p style={{ color: "var(--ink2)", fontSize: 13, margin: "8px 0 0", maxWidth: "64ch" }}>
              The analyst matches each marked drop to what was happening in the video at that moment
              and hands you fixes with expected outcomes — logged to your Ledger and checked later.
            </p>
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12.5, color: "var(--acc)", cursor: "pointer" }}>
                Add your script (optional) — quotes make the read sharper
              </summary>
              <textarea
                className="input"
                rows={5}
                style={{ marginTop: 8, width: "100%", resize: "vertical", fontFamily: "inherit" }}
                placeholder="Paste the script or transcript here…"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
            </details>
            {askErr && <div className="err" style={{ marginTop: 12 }}>{askErr}</div>}
            <div style={{ marginTop: 12 }}>
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
          </>
        )}
      </div>
    </>
  );
}
