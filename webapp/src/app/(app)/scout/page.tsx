"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";
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
  you_can_act_on: string[];
  out_of_your_hands: string[];
  options: ScoutOption[];
};
type ScoutResult = {
  analysis: ScoutAnalysis;
  video: { id: string; title: string; channelTitle: string; viewCount: number | null; publishedAt: string | null };
};

const OPTION_BADGE: Record<ScoutOption["type"], { label: string; cls: string }> = {
  safe: { label: "The safe bet", cls: "good" },
  reach: { label: "The smart reach", cls: "acc" },
  bold: { label: "The bold swing", cls: "warn" },
};

export default function ScoutPage() {
  const supabase = supabaseBrowser();
  const [url, setUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScoutResult | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());

  async function compare() {
    setErr(null);
    setWorking(true);
    setLogged(new Set());
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ url }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The Scout couldn't finish the comparison.");
      setResult({ analysis: j.analysis, video: j.video });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The Scout couldn't finish the comparison.");
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
      agent: "The Scout",
      category: o.category || "content",
      recommendation: o.takeaway,
      target_type: "channel",
      notes: `${o.why} — learned from "${result.video.title}" (${result.video.channelTitle})`,
      confidence: Math.max(0, Math.min(100, Math.round(o.confidence))),
      evidence: o.evidence ?? [],
    });
    if (!error) setLogged((s) => new Set(s).add(o.takeaway));
  }

  return (
    <>
      <div className="pagehead"><h1>Learn from any video</h1></div>
      <div className="card">
        <span className="k">Paste a video that caught your eye</span>
        <label className="field" style={{ marginTop: 10 }}>
          <span>A YouTube link from any channel</span>
          <input
            className="input"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !working) compare(); }}
          />
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-acc" onClick={compare} disabled={working || !url.trim()}>
          {working ? "Comparing, factor by factor…" : "Ask the Scout"}
        </button>
        <Explain
          why="Another creator's view count only helps you if you know WHY it's higher or lower than yours."
          how="Public facts, side by side — how new it is, channel size, how it ran against that channel's own normal, packaging, length, engagement. No guesswork, no earnings talk."
          what="Take what's actually yours to act on — the Scout says plainly which factors aren't."
        />
      </div>

      {result && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 14 }}>&quot;{result.video.title}&quot;</b>
            <span style={{ color: "var(--ink3)", fontSize: 12 }}>{result.video.channelTitle}</span>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>{result.analysis.read}</p>

          {result.analysis.factors.length > 0 && (
            <div style={{ marginTop: 14, overflowX: "auto" }}>
              <table className="t rowed">
                <thead>
                  <tr><th>Factor</th><th>Them</th><th>You</th><th>What it means</th></tr>
                </thead>
                <tbody>
                  {result.analysis.factors.map((f, i) => (
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

          <div className="grid g2" style={{ marginTop: 14 }}>
            {result.analysis.you_can_act_on.length > 0 && (
              <div>
                <span className="k">You can act on</span>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                  {result.analysis.you_can_act_on.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {result.analysis.out_of_your_hands.length > 0 && (
              <div>
                <span className="k">Out of your hands — honestly</span>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                  {result.analysis.out_of_your_hands.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>

          {result.analysis.options.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <span className="k">Three ways to use this — you pick</span>
              <div className="grid g3" style={{ marginTop: 10, alignItems: "stretch" }}>
                {result.analysis.options.map((o) => {
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
                          <span className="pill good">✓ in your Ledger — Scorekeeper will check it</span>
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
        </div>
      )}
    </>
  );
}
