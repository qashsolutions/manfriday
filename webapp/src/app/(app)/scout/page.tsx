"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, fmtNum, type ChannelData } from "@/lib/channelData";
import { Explain, WrongClaim } from "@/components/Explain";
import { Md } from "@/components/Md";
import { proseBuffer, readAnalystStream, Working } from "@/components/Working";
import { ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";

type ScoutOption = {
  type: "safe" | "reach" | "bold";
  takeaway: string;
  category: string;
  why: string;
  confidence: number;
  evidence: EvidenceItem[];
};
type ScoutAnalysis = {
  read: string;
  factors: { factor: string; theirs: string; yours: string; note: string }[];
  title_read: { their_title: string[]; your_title: string[]; note: string };
  viewers_say: {
    summary: string;
    receipts: { quote: string; likes: number }[];
    asks: string[];
    your_side: string;
  };
  retention_note: string;
  you_can_act_on: string[];
  out_of_your_hands: string[];
  options: ScoutOption[];
};
type SideStats = {
  title: string;
  viewCount: number | null;
  publishedAt: string | null;
  durationSeconds: number | null;
};
type ScoutResult = {
  analysis: ScoutAnalysis;
  video: SideStats & { channelTitle: string; likeCount: number | null; commentCount: number | null; subscriberCount: number | null; theirRatio: number | null };
  mine: (SideStats & { myRatio: number | null }) | null;
};

const OPTION_BADGE: Record<ScoutOption["type"], { label: string; cls: string }> = {
  safe: { label: "The safe bet", cls: "good" },
  reach: { label: "The smart reach", cls: "acc" },
  bold: { label: "The bold swing", cls: "warn" },
};

function mmss(s: number | null): string {
  if (s === null) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

import { TEAM, agentNames, sentenceCase } from "@/lib/team";

function Byline({ who, part }: { who: { name: string; job: string }; part: string }) {
  return <span className="k" title={who.job} style={{ display: "block", marginBottom: 8 }}>{sentenceCase(who.name)} — {part}</span>;
}

export default function ScoutPage() {
  const supabase = supabaseBrowser();
  const [data, setData] = useState<ChannelData | null>(null);
  const [url, setUrl] = useState("");
  const [mine, setMine] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScoutResult | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [stages, setStages] = useState<string[]>([]);
  const [prose, setProse] = useState("");

  useEffect(() => { loadChannelData().then(setData); }, []);

  async function compare() {
    setErr(null);
    setWorking(true);
    setLogged(new Set());
    setResult(null);
    setProse("");
    setStages([`${sentenceCase(TEAM.scout.name)} is picking up both videos…`]);
    const prose = proseBuffer((add) => setProse((p) => p + add));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ url, mine: mine || undefined }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "The comparison couldn't finish.");
      }
      if (!r.body) throw new Error("The comparison couldn't finish.");

      let j: ScoutResult | null = null;
      for await (const ev of readAnalystStream<ScoutResult>(r.body)) {
        if (ev.t === "stage") setStages((s) => [...s, ev.m]);
        else if (ev.t === "prose") prose.push(ev.d);
        else if (ev.t === "error") throw new Error(ev.error);
        else if (ev.t === "done") j = ev;
      }
      prose.flush();
      if (!j) throw new Error("The comparison stopped before it finished — try again.");

      setResult({ analysis: j.analysis, video: j.video, mine: j.mine });
      // Takeaways already in the Ledger — so "log it" doesn't double up.
      const takeaways = (j.analysis.options as ScoutOption[]).map((o) => o.takeaway);
      const { data: existing } = await supabase
        .from("recommendations").select("recommendation")
        .in("agent", agentNames(TEAM.scout)).in("recommendation", takeaways);
      if (existing?.length) {
        setLogged(new Set((existing as { recommendation: string }[]).map((x) => x.recommendation)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The comparison couldn't finish.");
    } finally {
      setWorking(false);
    }
  }

  /** "I'll take this" → the pick lands in the Ledger for the Scorekeeper. */
  async function logPick(o: ScoutOption) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !result) return;
    const { error } = await supabase.from("recommendations").insert({
      user_id: user.id,
      agent: TEAM.scout.name,
      category: o.category || "content",
      recommendation: o.takeaway,
      target_type: "channel",
      notes: `${o.why} — learned from "${result.video.title}" (${result.video.channelTitle})`,
      confidence: Math.max(0, Math.min(100, Math.round(o.confidence))),
      evidence: o.evidence ?? [],
      option_type: o.type,
    });
    if (!error) setLogged((s) => new Set(s).add(o.takeaway));
  }

  const a = result?.analysis;

  return (
    <>
      <div className="pagehead"><h1>Compare with any video</h1></div>
      <div className="card">
        <span className="k">Your video vs a similar one from anywhere</span>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <label className="field">
            <span>A YouTube link from any channel</span>
            <input
              className="input"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !working) compare(); }}
            />
          </label>
          <label className="field">
            <span>Compare with — one of yours (optional)</span>
            <select className="input" value={mine} onChange={(e) => setMine(e.target.value)}>
              <option value="">My channel&apos;s normal</option>
              {(data?.videos ?? []).map((v) => (
                <option key={v.yt_video_id} value={v.yt_video_id}>
                  {(v.title ?? v.yt_video_id).slice(0, 60)} — {fmtNum(v.view_count)} views
                </option>
              ))}
            </select>
          </label>
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-acc" onClick={compare} disabled={working || !url.trim()}>
          {working ? "The team is reading both sides…" : "Compare"}
        </button>
        <Explain
          why="Another creator's view count only helps you if you know WHY it's different from yours."
          how="Four things, side by side, from public facts: views (each against its own channel's normal), what viewers say and ask in the comments, the titles, and who owns the account. No guesswork, no earnings talk."
          what="Take what's actually yours to act on — the team says plainly which factors aren't."
        />
      </div>

      {working && !result && (
        <div className="card" style={{ marginTop: 14 }}>
          <Working stages={stages} />
          {prose && (
            <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}>
              <Md md={prose} />
            </div>
          )}
        </div>
      )}

      {result && a && (
        <div className="card" style={{ marginTop: 14 }}>
          {/* Stats, side by side */}
          <div className="grid g2" style={{ alignItems: "stretch" }}>
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13 }}>
              <span className="k">Theirs</span>
              <b style={{ display: "block", fontSize: 13.5, margin: "6px 0 2px" }}>&quot;{result.video.title}&quot;</b>
              <span style={{ color: "var(--ink3)", fontSize: 12 }}>
                {result.video.channelTitle}{result.video.subscriberCount !== null ? ` · ${fmtNum(result.video.subscriberCount)} subscribers` : ""}
              </span>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 12.5 }}>
                <span><b className="num">{fmtNum(result.video.viewCount)}</b> views{result.video.theirRatio !== null ? ` (${result.video.theirRatio}× their normal)` : ""}</span>
                <span><b className="num">{fmtNum(result.video.likeCount)}</b> likes</span>
                <span><b className="num">{fmtNum(result.video.commentCount)}</b> comments</span>
                <span>{mmss(result.video.durationSeconds)}</span>
                {result.video.publishedAt && <span>{new Date(result.video.publishedAt).toLocaleDateString()}</span>}
              </div>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13 }}>
              <span className="k">Yours</span>
              {result.mine ? (
                <>
                  <b style={{ display: "block", fontSize: 13.5, margin: "6px 0 2px" }}>&quot;{result.mine.title}&quot;</b>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 12.5 }}>
                    <span><b className="num">{fmtNum(result.mine.viewCount)}</b> views{result.mine.myRatio !== null ? ` (${result.mine.myRatio}× your normal)` : ""}</span>
                    <span>{mmss(result.mine.durationSeconds)}</span>
                    {result.mine.publishedAt && <span>{new Date(result.mine.publishedAt).toLocaleDateString()}</span>}
                  </div>
                </>
              ) : (
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink2)" }}>
                  Compared against your channel&apos;s normal — pick one of your videos above for a video-to-video read.
                </p>
              )}
            </div>
          </div>

          {/* The Scout's read + factors */}
          <div style={{ marginTop: 16 }}>
            <Byline who={TEAM.scout} part="the read" />
            <Md md={a.read} />
          </div>
          {a.factors.length > 0 && (
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table className="t rowed">
                <thead>
                  <tr><th>Factor</th><th>Them</th><th>You</th><th>What it means</th></tr>
                </thead>
                <tbody>
                  {a.factors.map((f, i) => (
                    <tr key={i}>
                      <td><b style={{ fontSize: 12.5 }}>{f.factor}</b></td>
                      <td className="num">{f.theirs}</td>
                      <td className="num">{f.yours}</td>
                      <td style={{ color: "var(--ink2)", fontSize: 12.5 }}>{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The Marketer — titles */}
          <div style={{ marginTop: 16 }}>
            <Byline who={TEAM.marketer} part="the titles" />
            <div className="grid g2">
              {a.title_read.their_title.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                  {a.title_read.their_title.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
              {a.title_read.your_title.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                  {a.title_read.your_title.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 13 }}>{a.title_read.note}</p>
          </div>

          {/* The Listener — comments */}
          <div style={{ marginTop: 16 }}>
            <Byline who={TEAM.listener} part="what their viewers say" />
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{a.viewers_say.summary}</p>
            {a.viewers_say.receipts.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {a.viewers_say.receipts.map((r, i) => (
                  <div key={i} style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10, fontSize: 12.5, color: "var(--ink2)" }}>
                    &quot;{r.quote}&quot; <span style={{ color: "var(--ink3)" }}>· {r.likes} likes</span>
                  </div>
                ))}
              </div>
            )}
            {a.viewers_say.asks.length > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                <b>They ask for:</b> {a.viewers_say.asks.join(" · ")}
              </p>
            )}
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--ink3)" }}>{a.viewers_say.your_side}</p>
          </div>

          {/* The Editor — honest note */}
          <div style={{ marginTop: 16 }}>
            <Byline who={TEAM.editor} part="on watch time" />
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{a.retention_note}</p>
          </div>

          <div className="grid g2" style={{ marginTop: 16 }}>
            {a.you_can_act_on.length > 0 && (
              <div>
                <span className="k">You can act on</span>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                  {a.you_can_act_on.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {a.out_of_your_hands.length > 0 && (
              <div>
                <span className="k">Out of your hands — honestly</span>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                  {a.out_of_your_hands.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>

          {a.options.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <span className="k">Three ways to use this — you pick, the Scorekeeper checks whatever you log</span>
              <div className="grid g3" style={{ marginTop: 10, alignItems: "stretch" }}>
                {a.options.map((o) => {
                  const badge = OPTION_BADGE[o.type] ?? OPTION_BADGE.safe;
                  return (
                    <div key={o.takeaway} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                      <span className={`pill ${badge.cls}`} style={{ alignSelf: "flex-start", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10.5 }}>
                        {badge.label}
                      </span>
                      <b style={{ fontSize: 13.5 }}>{o.takeaway}</b>
                      <div style={{ color: "var(--ink2)", fontSize: 12.5 }}>{o.why}</div>
                      <ConfidenceBar value={o.confidence} />
                      <EvidenceChips items={o.evidence} />
                      <div style={{ marginTop: "auto" }}>
                        {logged.has(o.takeaway) ? (
                          <span className="pill good">✓ in your Ledger — {TEAM.scorekeeper.name} will check it</span>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => logPick(o)}>
                            I&apos;ll take this — log it
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <WrongClaim context={`Comparison with "${result.video.title}"`} />
        </div>
      )}
    </>
  );
}
