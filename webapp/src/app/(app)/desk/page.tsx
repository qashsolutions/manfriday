"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, fmtNum, daysAgo, type ChannelData } from "@/lib/channelData";
import { Explain, RatioBar, Thumb } from "@/components/Explain";

export default function DeskPage() {
  const supabase = supabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<ChannelData>({ channel: null, baselines: {}, videos: [], flagsActive: false });
  const [openTips, setOpenTips] = useState(0);
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [tuneHidden, setTuneHidden] = useState(true);

  useEffect(() => {
    try { setTuneHidden(localStorage.getItem("mf-tune-dismissed") === "1"); } catch {}
  }, []);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [prof, cd, recs] = await Promise.all([
      supabase.from("profiles").select("paused_at").eq("id", user.id).maybeSingle(),
      loadChannelData(),
      supabase.from("recommendations").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);
    setPaused(Boolean(prof.data?.paused_at));
    setData(cd);
    setOpenTips(recs.count ?? 0);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function runFirstAnalysis() {
    setRunErr(null);
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analysis/first-run", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The analysis couldn't finish.");
      await load();
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : "The analysis couldn't finish.");
    } finally {
      setRunning(false);
    }
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const { channel, baselines, videos, flagsActive } = data;
  const hasBaseline = Boolean(baselines.longform || baselines.shorts);
  // Attention = real outliers among RECENT uploads only — a 4-year-old video
  // doesn't "need attention," and flags don't exist at all on thin data.
  const attention = [...videos]
    .filter((v) => (v.flag === "underperformer" || v.flag === "outperformer"))
    .filter((v) => { const d = daysAgo(v.published_at); return d !== null && d <= 120; })
    .sort((a, b) => (a.flag === "underperformer" ? 0 : 1) - (b.flag === "underperformer" ? 0 : 1))
    .slice(0, 5);
  const recent = videos.slice(0, 5);

  if (loading) return <div className="quiet">Opening the Desk…</div>;

  return (
    <>
      <div className="pagehead">
        <h1>The Desk</h1>
        <span className="when">{today}</span>
        {hasBaseline && (
          <span className="byline" style={{ marginLeft: "auto" }}>
            <i />Updated from your YouTube numbers
          </span>
        )}
      </div>

      {paused && (
        <div className="banner">
          Your account is paused — the team isn&apos;t running any analysis. Resume any time in{" "}
          <Link href="/settings">Settings</Link>.
        </div>
      )}

      {!channel ? (
        <div className="empty" style={{ padding: 48 }}>
          <div className="tick" style={{ margin: "0 auto 16px" }} />
          <b>Your team of six is ready. They just need a channel.</b>
          Connect your YouTube channel and your first results — what&apos;s normal for you, your wins
          and misses — arrive in about two minutes.
          <div style={{ marginTop: 18 }}>
            <Link href="/settings#connections" className="btn btn-acc btn-lg">Connect my channel</Link>
          </div>
          <div style={{ marginTop: 10, fontSize: 12 }}>
            Read-only: we can look, we can&apos;t touch. Disconnect any time with one click.
          </div>
        </div>
      ) : !hasBaseline ? (
        <div className="empty" style={{ padding: 44 }}>
          <div className="tick" style={{ margin: "0 auto 16px" }} />
          <b>{channel.title ?? "Your channel"} is connected. Ready for the first read?</b>
          The team reads your last 30 uploads, works out what&apos;s normal for you, and flags your
          wins and misses. Takes under a minute.
          {runErr && <div className="err" style={{ marginTop: 14, textAlign: "left" }}>{runErr}</div>}
          <div style={{ marginTop: 18 }}>
            <button className="btn btn-acc btn-lg" onClick={runFirstAnalysis} disabled={running}>
              {running ? "Reading your channel…" : "Start my first analysis"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {!tuneHidden && (
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, borderStyle: "dashed", marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <b style={{ fontSize: 13.5 }}>Want sharper advice?</b>
                <span style={{ color: "var(--ink2)", fontSize: 13 }}> Four quick questions — your goals, your tone, who you compare yourself to.</span>
              </div>
              <Link href="/profile" className="btn btn-ghost btn-sm">Take 90 seconds</Link>
              <button
                className="iconbtn" aria-label="Dismiss" title="Dismiss"
                onClick={() => { setTuneHidden(true); try { localStorage.setItem("mf-tune-dismissed", "1"); } catch {} }}
              >✕</button>
            </div>
          )}
          <div className="grid g3">
            <div className="card stat">
              <span className="k">Channel</span>
              <div className="big">{channel.handle ?? channel.title}</div>
              <span className="delta fl num">{fmtNum(channel.subscriber_count)} subscribers</span>
            </div>
            <div className="card stat">
              <span className="k">Normal for you</span>
              <div className="big num">{fmtNum(baselines.longform?.median_views ?? baselines.shorts?.median_views)}</div>
              <span className="delta fl">
                {baselines.longform
                  ? `views a full video usually gets (last ${baselines.longform.sample_size})`
                  : `views a Short usually gets (last ${baselines.shorts?.sample_size})`}
                {baselines.longform && baselines.shorts
                  ? ` · Shorts: ${fmtNum(baselines.shorts.median_views)}`
                  : ""}
              </span>
            </div>
            <div className="card stat">
              <span className="k">Team track record</span>
              <div className="big num">{openTips} open</div>
              <span className="delta fl">your first verdict lands a few days after you apply a tip</span>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h4 style={{ margin: 0, fontSize: 13.5 }}>
                {flagsActive ? "Needs your attention" : "Your recent videos"}
              </h4>
              <Link href="/why" style={{ fontSize: 12, color: "var(--acc)" }}>all videos →</Link>
            </div>

            {!flagsActive && (
              <div className="aside-note" style={{ margin: "10px 0 4px" }}>
                <b>Early days — no verdicts yet, on purpose</b>
                With videos under ~100 views, ×-comparisons are noise, not judgment. The team tracks
                everything below; flags switch on by themselves as your numbers grow.
              </div>
            )}

            {(flagsActive ? attention : recent).length === 0 ? (
              <p style={{ color: "var(--ink2)", fontSize: 13 }}>
                Nothing unusual right now — your recent videos are tracking close to your normal.
              </p>
            ) : (
              <table className="t rowed" style={{ marginTop: 8 }}>
                <tbody>
                  {(flagsActive ? attention : recent).map((v) => (
                    <tr key={v.id}>
                      <td style={{ padding: "9px 10px 9px 0" }}>
                        <div className="vcell">
                          <Thumb url={v.thumbnail_url} alt="" />
                          <div>
                            <b style={{ fontSize: 13 }}>{v.title ?? v.yt_video_id}</b>
                            <div className="sub">
                              {v.published_at ? new Date(v.published_at).toLocaleDateString() : ""}
                              {v.is_short ? " · Short" : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num" style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{fmtNum(v.view_count)} views</td>
                      <td style={{ padding: "9px 0", minWidth: 150 }}>
                        <RatioBar ratio={v.ratio} muted={!flagsActive} />
                      </td>
                      <td style={{ padding: "9px 0 9px 10px" }}>
                        {v.flag === "underperformer" && (
                          <Link href={`/why/${v.id}`} className="btn btn-acc btn-sm">Why?</Link>
                        )}
                        {v.flag === "outperformer" && (
                          <Link href={`/why/${v.id}`} className="btn btn-ghost btn-sm">What worked?</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {(baselines.longform || baselines.shorts) && (
            <div className="card" style={{ marginTop: 14 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13.5 }}>Your two normals</h4>
              {(["longform", "shorts"] as const).map((fmt) => {
                const b = baselines[fmt];
                if (!b) return null;
                const other = baselines[fmt === "longform" ? "shorts" : "longform"];
                const maxMed = Math.max(b.median_views, other?.median_views ?? 0, 1);
                return (
                  <div key={fmt} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 86, fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>
                      {fmt === "longform" ? "Full videos" : "Shorts"}
                    </span>
                    <div style={{ flex: 1, height: 10, borderRadius: 4, background: "var(--line2)", position: "relative" }}>
                      <div style={{
                        position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4,
                        width: `${Math.max(4, (b.median_views / maxMed) * 100)}%`,
                        background: fmt === "longform" ? "var(--acc)" : "var(--chart2)",
                      }} />
                    </div>
                    <span className="num" style={{ fontSize: 12, width: 110, textAlign: "right" }}>
                      {fmtNum(b.median_views)} <span style={{ color: "var(--ink3)" }}>({b.sample_size} videos)</span>
                    </span>
                  </div>
                );
              })}
              <Explain
                why="YouTube ranks Shorts and full videos separately — one shared average would mislead you on both."
                how="Median views of your recent uploads, per format. Medians ignore one-off spikes."
                what="Every video is judged against its own format's bar — that's what the ×-numbers everywhere mean."
              />
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <span className="k">Your team is on duty</span>
            <p style={{ color: "var(--ink2)", margin: "8px 0 0", fontSize: 13 }}>
              Open any video for the <Link href="/why" style={{ color: "var(--acc)" }}>Retention Analyst&apos;s read</Link>,
              grade your next <Link href="/packaging" style={{ color: "var(--acc)" }}>title</Link>,
              have the <Link href="/ideas" style={{ color: "var(--acc)" }}>Audience Analyst read your comments</Link>,
              or ask for <Link href="/reports" style={{ color: "var(--acc)" }}>this week&apos;s report</Link>.
            </p>
          </div>
        </>
      )}
    </>
  );
}
