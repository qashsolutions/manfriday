"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, fmtNum, daysAgo, type ChannelData } from "@/lib/channelData";
import { RatioBar, Thumb } from "@/components/Explain";

export default function DeskPage() {
  const supabase = supabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<ChannelData>({ channel: null, baselines: {}, videos: [], flagsActive: false, lastUpdated: null });
  const [ledger, setLedger] = useState({ open: 0, worked: 0, mixed: 0, failed: 0 });
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
      supabase.from("recommendations").select("status,verdict"),
    ]);
    setPaused(Boolean(prof.data?.paused_at));
    setData(cd);
    const rows = (recs.data ?? []) as { status: string; verdict: string | null }[];
    setLedger({
      open: rows.filter((r) => r.status === "open").length,
      worked: rows.filter((r) => r.verdict === "worked").length,
      mixed: rows.filter((r) => r.verdict === "mixed").length,
      failed: rows.filter((r) => r.verdict === "failed").length,
    });
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
          <span style={{ marginLeft: "auto", fontStyle: "italic", fontSize: 12, color: "var(--ink3)" }}>
            Updated from your YouTube numbers
            {data.lastUpdated
              ? ` · ${new Date(data.lastUpdated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : ""}
          </span>
        )}
      </div>
      {hasBaseline && (
        <p style={{ margin: "-6px 0 14px", fontSize: 13, color: "var(--ink2)" }}>
          Today&apos;s numbers, today&apos;s one thing to do.
        </p>
      )}

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
              {ledger.worked + ledger.mixed + ledger.failed > 0 ? (
                <>
                  <div className="big num">{ledger.worked}/{ledger.worked + ledger.mixed + ledger.failed} worked</div>
                  <span className="delta fl">
                    mixed {ledger.mixed} · didn&apos;t {ledger.failed} · {ledger.open} open —{" "}
                    <Link href="/ledger" style={{ color: "var(--acc)" }}>see the Ledger</Link>
                  </span>
                </>
              ) : (
                <>
                  <div className="big num">{ledger.open} waiting</div>
                  <span className="delta fl">
                    every tip you apply gets checked against your real numbers —{" "}
                    <Link href="/ledger" style={{ color: "var(--acc)" }}>see them</Link>
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h4 style={{ margin: 0, fontSize: 13.5 }}>
                {flagsActive ? "Needs your attention" : "Your recent videos"}
              </h4>
              <Link href="/why" style={{ fontSize: 12, color: "var(--acc)", textDecoration: "none" }}>All your videos</Link>
            </div>

            {!flagsActive && (
              <div className="aside-note" style={{ margin: "10px 0 4px" }}>
                <b>Early days — no verdicts yet, on purpose</b>
                While your videos are under about 100 views, one extra viewer can double a score —
                the numbers jump around too much to call anything a win or a miss. So we don&apos;t.
                The team still tracks everything below, and verdicts switch on by themselves as your
                views grow.
              </div>
            )}

            {(flagsActive ? attention : recent).length === 0 ? (
              <p style={{ color: "var(--ink2)", fontSize: 13 }}>
                Nothing unusual right now — your recent videos are tracking close to your normal.
              </p>
            ) : (
              <table className="t rowed" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "0 10px 4px 0" }}></th>
                    <th style={{ padding: "0 10px 4px" }}></th>
                    <th style={{ padding: "0 0 4px", fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink3)", textAlign: "left" }}>
                      how it did vs your usual video
                    </th>
                    <th></th>
                  </tr>
                </thead>
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
                      <td className="num" style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{fmtNum(v.view_count)} {v.view_count === 1 ? "view" : "views"}</td>
                      <td style={{ padding: "9px 0", minWidth: 150 }}>
                        <RatioBar ratio={v.ratio} muted={!flagsActive} />
                      </td>
                      <td style={{ padding: "9px 0 9px 10px" }}>
                        {v.flag === "underperformer" ? (
                          <Link href={`/why/${v.id}`} className="btn btn-acc btn-sm">Why?</Link>
                        ) : v.flag === "outperformer" ? (
                          <Link href={`/why/${v.id}`} className="btn btn-ghost btn-sm">What worked?</Link>
                        ) : (
                          <Link href={`/why/${v.id}`} className="btn btn-ghost btn-sm">Open</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(flagsActive ? attention : recent).length > 0 && (
              <div style={{ margin: "12px 0 0", fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                <p style={{ margin: 0 }}>
                  &quot;Your usual video&quot; gets about{" "}
                  <b>{fmtNum(baselines.longform?.median_views ?? baselines.shorts?.median_views)} views</b> right now —
                  the line on each bar marks it.
                </p>
                <p style={{ margin: "4px 0 0" }}>
                  {flagsActive
                    ? "The low ones are worth a “Why?” and the high ones are worth copying — that's where the next video gets better."
                    : "Your numbers are still small, so treat this as a picture, not a verdict — open any video for the full story."}
                </p>
              </div>
            )}
          </div>

          {(baselines.longform || baselines.shorts) && (
            <div className="card" style={{ marginTop: 14 }}>
              <h4 style={{ margin: "0 0 4px", fontSize: 13.5 }}>Your measuring stick</h4>
              <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--ink2)" }}>
                {baselines.longform
                  ? <>A full video of yours usually gets about <b>{fmtNum(baselines.longform.median_views)} views</b>{baselines.shorts ? <> — a Short about <b>{fmtNum(baselines.shorts.median_views)}</b></> : null}. That&apos;s your bar.{" "}</>
                  : baselines.shorts
                    ? <>A Short of yours usually gets about <b>{fmtNum(baselines.shorts.median_views)} views</b>. That&apos;s your bar.{" "}</>
                    : null}
                Beat it and you&apos;ve genuinely done better — no comparing yourself with big channels.
                When a video clears the bar, the team digs into why, so you can do it again on purpose.
              </p>
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
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <span className="k">What your team can do for you right now</span>
            <div style={{ display: "grid", gap: 9, marginTop: 10 }}>
              {[
                { href: "/why", text: "Find the exact second viewers quit your last video", who: "Retention Analyst" },
                { href: "/packaging", text: "Know which title wins — before you publish", who: "Packaging Analyst" },
                { href: "/ideas", text: "Get video ideas your viewers have already asked for", who: "Audience Analyst" },
                { href: "/scout", text: "See why a video like yours got more views — and what's yours to take", who: "The Scout" },
                { href: "/reports", text: "Your week in two minutes, with the one decision it needs", who: "The Team" },
              ].map((r) => (
                <div key={r.href} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <Link href={r.href} style={{ color: "var(--acc)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                    {r.text}
                  </Link>
                  <span className="sub" style={{ marginLeft: "auto" }}>{r.who}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
