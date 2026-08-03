"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, fmtNum, type ChannelData } from "@/lib/channelData";

export default function DeskPage() {
  const supabase = supabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<ChannelData>({ channel: null, baselines: {}, videos: [] });
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
  const { channel, baselines, videos } = data;
  const hasBaseline = Boolean(baselines.longform || baselines.shorts);
  const attention = [...videos]
    .filter((v) => v.flag)
    .sort((a, b) => {
      const rank = (f: string | null) => (f === "underperformer" ? 0 : f === "outperformer" ? 1 : 2);
      return rank(a.flag) - rank(b.flag);
    })
    .slice(0, 5);

  if (loading) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Opening the Desk…</div>;

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
              <h4 style={{ margin: 0, fontSize: 13.5 }}>Needs your attention</h4>
              <Link href="/why" style={{ fontSize: 12, color: "var(--acc)" }}>all videos →</Link>
            </div>
            {attention.length === 0 ? (
              <p style={{ color: "var(--ink2)", fontSize: 13 }}>
                Nothing unusual right now — your recent videos are tracking close to your normal.
              </p>
            ) : (
              <table className="t" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
                <tbody>
                  {attention.map((v) => (
                    <tr key={v.id} style={{ borderTop: "1px solid var(--line2)" }}>
                      <td style={{ padding: "9px 10px 9px 0" }}>
                        <b style={{ fontSize: 13 }}>{v.title ?? v.yt_video_id}</b>
                        <div style={{ color: "var(--ink3)", fontSize: 11.5 }}>
                          {v.published_at ? new Date(v.published_at).toLocaleDateString() : ""}
                          {v.is_short ? " · Short" : ""}
                        </div>
                      </td>
                      <td className="num" style={{ padding: "9px 10px" }}>{fmtNum(v.view_count)} views</td>
                      <td style={{ padding: "9px 0" }}>
                        {v.flag === "underperformer" && <span className="pill crit">{v.ratio}× — well below normal</span>}
                        {v.flag === "outperformer" && <span className="pill good">{v.ratio}× — a hit</span>}
                        {v.flag === "typical" && <span className="pill mut">about normal</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <span className="k">Coming next from your team</span>
            <p style={{ color: "var(--ink2)", margin: "8px 0 0", fontSize: 13 }}>
              Retention reads (&quot;why videos win or die&quot;), packaging grades, and the idea list are the
              next analysts to come online. Your baseline and outliers above are already real.
            </p>
          </div>
        </>
      )}
    </>
  );
}
