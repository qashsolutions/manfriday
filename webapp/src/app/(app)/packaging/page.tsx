"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData } from "@/lib/channelData";
import { Explain } from "@/components/Explain";
import { ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";
import { TEAM, agentNames, sentenceCase } from "@/lib/team";

type GradeOption = {
  type: "safe" | "reach" | "bold";
  title: string;
  why: string;
  confidence: number;
  evidence: EvidenceItem[];
  audience_fit: string | null;
};
type Grade = {
  grade: string;
  one_line: string;
  strengths: string[];
  risks: string[];
  options: GradeOption[];
  search_note: string | null;
  thin_data_note: string | null;
  thumb_read: { one_line: string; works: string[]; risks: string[] } | null;
};

const OPTION_BADGE: Record<GradeOption["type"], { label: string; cls: string }> = {
  safe: { label: "The safe bet", cls: "good" },
  reach: { label: "The smart reach", cls: "acc" },
  bold: { label: "The bold swing", cls: "warn" },
};

function gradeColors(g: string): { bg: string; fg: string } {
  if (g.startsWith("A")) return { bg: "var(--good-soft)", fg: "var(--good)" };
  if (g.startsWith("B")) return { bg: "var(--acc-soft)", fg: "var(--acc)" };
  if (g.startsWith("C")) return { bg: "var(--warn-soft)", fg: "var(--warn)" };
  return { bg: "var(--crit-soft)", fg: "var(--crit)" };
}

export default function PackagingPage() {
  const supabase = supabaseBrowser();
  const [ready, setReady] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [thumb, setThumb] = useState<string | null>(null);
  const [thumbErr, setThumbErr] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ draft: string; analysis: Grade } | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadChannelData().then((d) => setReady(Boolean(d.baselines.longform || d.baselines.shorts)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function gradeIt() {
    setErr(null);
    setGrading(true);
    setLogged(new Set());
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/packaging", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ title: draft, thumbnail: thumb ?? undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The grading couldn't finish.");
      setResult({ draft, analysis: j.analysis });
      // Rewrites already in the Ledger — so "log it" doesn't double up.
      const asRecs = (j.analysis.options as GradeOption[]).map((o) => `Use the title: "${o.title}"`);
      const { data: existing } = await supabase
        .from("recommendations").select("recommendation")
        .in("agent", agentNames(TEAM.marketer)).in("recommendation", asRecs);
      if (existing?.length) {
        const found = new Set((existing as { recommendation: string }[]).map((x) => x.recommendation));
        setLogged(new Set((j.analysis.options as GradeOption[])
          .filter((o) => found.has(`Use the title: "${o.title}"`))
          .map((o) => o.title)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The grading couldn't finish.");
    } finally {
      setGrading(false);
    }
  }

  /** "I'll use this one" → written to the Ledger so the Scorekeeper can check it later. */
  async function logPick(o: GradeOption) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("recommendations").insert({
      user_id: user.id,
      agent: TEAM.marketer.name,
      category: "packaging",
      recommendation: `Use the title: "${o.title}"`,
      target_type: "channel",
      notes: o.why,
      confidence: o.confidence ?? null,
      evidence: o.evidence ?? [],
      option_type: o.type,
    });
    if (!error) setLogged((s) => new Set(s).add(o.title));
  }

  function onThumbFile(f: File | null) {
    setThumbErr(null);
    if (!f) { setThumb(null); return; }
    if (f.size > 3_000_000) { setThumbErr("Keep the image under 3MB."); return; }
    const reader = new FileReader();
    reader.onload = () => setThumb(String(reader.result));
    reader.readAsDataURL(f);
  }

  if (ready === null) return <div className="quiet">Loading…</div>;

  return (
    <>
      <div className="pagehead"><h1>Titles &amp; thumbnails</h1></div>
      {!ready ? (
        <div className="empty" style={{ padding: 40 }}>
          <b>Grading needs your baseline first</b>
          Your drafts get graded against your own past winners — so the team needs its first read
          of your channel before it can be honest about what works for you.
          <div style={{ marginTop: 14 }}>
            <Link className="btn btn-acc" href="/desk">Run the first analysis</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <span className="k">Your next upload&apos;s title</span>
            <label className="field" style={{ marginTop: 10 }}>
              <span>Paste your draft title</span>
              <input
                className="input"
                placeholder="e.g. Building My Dream Workshop Storage (Part 3)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && draft.trim() && !grading) gradeIt(); }}
              />
            </label>
            <label className="field">
              <span>Draft thumbnail (optional) — reviewed alongside the title</span>
              <input
                className="input" type="file" accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onThumbFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="Draft thumbnail preview" style={{ maxWidth: 240, borderRadius: 8, border: "1px solid var(--line)" }} />
            )}
            {thumbErr && <div className="err">{thumbErr}</div>}
            {err && <div className="err">{err}</div>}
            <button className="btn btn-acc" onClick={gradeIt} disabled={grading || !draft.trim()}>
              {grading ? "Grading against your winners…" : "Grade it against my winners"}
            </button>
            <Explain
              why="A weak title kills a good video before anyone watches it."
              how={`${sentenceCase(TEAM.marketer.name)} grades your draft against your own past winners and what people really type into YouTube — with the reason attached, never a bare score.`}
              what="Pick a rewrite you like and log it — the Scorekeeper checks the result after you publish."
            />
          </div>

          {result && (
            <div className="card" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <span style={{
                  width: 52, height: 52, borderRadius: 12, flex: "none",
                  background: gradeColors(result.analysis.grade).bg, color: gradeColors(result.analysis.grade).fg,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800,
                }}>
                  {result.analysis.grade}
                </span>
                <div>
                  <b style={{ fontSize: 14 }}>&quot;{result.draft}&quot;</b>
                  <div style={{ color: "var(--ink2)", fontSize: 13 }}>{result.analysis.one_line}</div>
                </div>
              </div>

              {result.analysis.thin_data_note && (
                <div className="aside-note" style={{ marginTop: 12 }}>
                  <b>Early days</b>
                  {result.analysis.thin_data_note}
                </div>
              )}

              {(result.analysis.strengths.length > 0 || result.analysis.risks.length > 0) && (
                <div className="grid g2" style={{ marginTop: 14 }}>
                  {result.analysis.strengths.length > 0 && (
                    <div>
                      <span className="k">What&apos;s working</span>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                        {result.analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {result.analysis.risks.length > 0 && (
                    <div>
                      <span className="k">Where it loses people</span>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                        {result.analysis.risks.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {result.analysis.search_note && (
                <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--ink2)" }}>
                  <b style={{ color: "var(--ink2)" }}>People type:</b> {result.analysis.search_note}
                </p>
              )}

              {result.analysis.thumb_read && (
                <div style={{ marginTop: 14 }}>
                  <span className="k">The thumbnail</span>
                  <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>{result.analysis.thumb_read.one_line}</p>
                  <div className="grid g2" style={{ marginTop: 8 }}>
                    {result.analysis.thumb_read.works.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                        {result.analysis.thumb_read.works.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                    {result.analysis.thumb_read.risks.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
                        {result.analysis.thumb_read.risks.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <span className="k">Three ways to go — you pick</span>
                <div className="grid g3" style={{ marginTop: 10, alignItems: "stretch" }}>
                  {result.analysis.options.map((a) => {
                    const badge = OPTION_BADGE[a.type] ?? OPTION_BADGE.safe;
                    return (
                      <div key={a.title} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                        <span className={`pill ${badge.cls}`} style={{ alignSelf: "flex-start", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10.5 }}>
                          {badge.label}
                        </span>
                        <b style={{ fontSize: 13.5 }}>{a.title}</b>
                        <div style={{ color: "var(--ink2)", fontSize: 12.5 }}>{a.why}</div>
                        <ConfidenceBar value={a.confidence} />
                        <EvidenceChips items={a.evidence} />
                        {a.audience_fit && (
                          <div className="sub">◎ {a.audience_fit}</div>
                        )}
                        <div style={{ marginTop: "auto" }}>
                          {logged.has(a.title) ? (
                            <span className="pill good">✓ in your Ledger — {TEAM.scorekeeper.name} will check it</span>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => logPick(a)}>
                              I&apos;ll use this — log it
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
