"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain, WrongClaim } from "@/components/Explain";
import { Md } from "@/components/Md";
import { Working } from "@/components/Working";
import { ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";
import { TEAM, agentNames, sentenceCase } from "@/lib/team";

type StreamEvent =
  | { t: "stage"; m: string }
  | { t: "prose"; d: string }
  | { t: "error"; error: string }
  | { t: "done"; report: Report; takeaways: Takeaway[] };

/** The analyst routes answer in newline-delimited JSON so the read can be shown
    while it is still being written. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as StreamEvent;
    }
  }
  const tail = buf.trim();
  if (tail) yield JSON.parse(tail) as StreamEvent;
}

type Report = { id: string; title: string; body_md: string; created_at: string };
type Takeaway = {
  type: "safe" | "reach" | "bold";
  takeaway: string;
  category: string;
  why: string;
  confidence: number;
  evidence: EvidenceItem[];
};

const OPTION_BADGE: Record<Takeaway["type"], { label: string; cls: string }> = {
  safe: { label: "The safe bet", cls: "good" },
  reach: { label: "The smart reach", cls: "acc" },
  bold: { label: "The bold swing", cls: "warn" },
};

export default function ResearchPage() {
  const supabase = supabaseBrowser();
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [takeaways, setTakeaways] = useState<Takeaway[]>([]);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [stages, setStages] = useState<string[]>([]);
  const [prose, setProse] = useState("");

  // Prose lands token by token; repaint on a short beat instead, so a long read
  // doesn't cost one re-render per word.
  const pending = useRef("");
  const beat = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showProse(delta: string) {
    pending.current += delta;
    if (beat.current) return;
    beat.current = setTimeout(() => {
      beat.current = null;
      setProse((p) => p + pending.current);
      pending.current = "";
    }, 60);
  }
  function flushProse() {
    if (beat.current) { clearTimeout(beat.current); beat.current = null; }
    if (pending.current) { setProse((p) => p + pending.current); pending.current = ""; }
  }

  async function research() {
    setErr(null);
    setWorking(true);
    setLogged(new Set());
    setReport(null);
    setTakeaways([]);
    setProse("");
    pending.current = "";
    setStages([`${sentenceCase(TEAM.researcher.name)} is picking up your question…`]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/research", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ query }),
      });
      // Guards that fire before the read starts still answer with a status code
      // and a whole JSON body; everything after that arrives on the stream.
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "The research couldn't finish.");
      }
      if (!r.body) throw new Error("The research couldn't finish.");

      let finished: Extract<StreamEvent, { t: "done" }> | null = null;
      for await (const ev of readEvents(r.body)) {
        if (ev.t === "stage") setStages((s) => [...s, ev.m]);
        else if (ev.t === "prose") showProse(ev.d);
        else if (ev.t === "error") throw new Error(ev.error);
        else if (ev.t === "done") finished = ev;
      }
      flushProse();
      if (!finished) throw new Error("The read stopped before it finished — try again.");

      setReport(finished.report);
      const t = (finished.takeaways ?? []) as Takeaway[];
      setTakeaways(t);
      if (t.length) {
        const { data: existing } = await supabase
          .from("recommendations").select("recommendation")
          .in("agent", agentNames(TEAM.researcher)).in("recommendation", t.map((x) => x.takeaway));
        if (existing?.length) {
          setLogged(new Set((existing as { recommendation: string }[]).map((x) => x.recommendation)));
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The research couldn't finish.");
    } finally {
      setWorking(false);
    }
  }

  /** "I'll take this angle" → the pick lands in the Ledger for the Scorekeeper. */
  async function logPick(t: Takeaway) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !report) return;
    const { error } = await supabase.from("recommendations").insert({
      user_id: user.id,
      agent: TEAM.researcher.name,
      category: t.category || "content",
      recommendation: t.takeaway,
      target_type: "channel",
      notes: `${t.why} — from "${report.title}"`,
      confidence: Math.max(0, Math.min(100, Math.round(t.confidence))),
      evidence: t.evidence ?? [],
      option_type: t.type,
    });
    if (!error) setLogged((s) => new Set(s).add(t.takeaway));
  }

  return (
    <>
      <div className="pagehead"><h1>Research a topic</h1></div>
      <div className="card">
        <span className="k">Point the Researcher at anything</span>
        <label className="field" style={{ marginTop: 10 }}>
          <span>A topic you&apos;re considering — or a video link</span>
          <input
            className="input"
            placeholder="e.g. carnatic violin for beginners — or a YouTube link"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim() && !working) research(); }}
          />
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-acc" onClick={research} disabled={working || !query.trim()}>
          {working ? "Reading what's out there…" : "Send the Researcher"}
        </button>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--ink3)", maxWidth: "60ch" }}>
          Honest limits: the Researcher reads public titles, descriptions and numbers — it doesn&apos;t
          watch the footage, and it can&apos;t see any other channel&apos;s private analytics or earnings.
        </p>
        <Explain
          why="Before you spend a week making something, spend a minute learning what's already out there."
          how="A live sweep of what YouTube shows everyone for your topic — who's making it, what runs beyond its own channel's size, what people type. Public data only, and the report says plainly what it can't know."
          what="Pick an angle that fits you and log it — the Scorekeeper checks the result after you act on it."
        />
      </div>

      {(working || report) && (
        <div className="card" style={{ marginTop: 14 }}>
          {report ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>{report.title}</b>
              <span style={{ color: "var(--ink3)", fontSize: 12 }}>
                {sentenceCase(TEAM.researcher.name)} · {new Date(report.created_at).toLocaleDateString()}
              </span>
              <Link href="/reports" style={{ marginLeft: "auto", color: "var(--acc)", fontSize: 12 }}>
                saved with your reports →
              </Link>
            </div>
          ) : (
            <Working stages={stages} />
          )}
          {(report || prose) && (
            <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}>
              <Md md={report ? report.body_md : prose} />
              {report && <WrongClaim context={report.title} />}
            </div>
          )}

          {takeaways.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <span className="k">Angles you could take — you pick</span>
              <div className="grid g3" style={{ marginTop: 10, alignItems: "stretch" }}>
                {takeaways.map((t) => {
                  const badge = OPTION_BADGE[t.type] ?? OPTION_BADGE.safe;
                  return (
                    <div key={t.takeaway} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                      <span className={`pill ${badge.cls}`} style={{ alignSelf: "flex-start", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10.5 }}>
                        {badge.label}
                      </span>
                      <b style={{ fontSize: 13.5 }}>{t.takeaway}</b>
                      <div style={{ color: "var(--ink2)", fontSize: 12.5 }}>{t.why}</div>
                      <ConfidenceBar value={t.confidence} />
                      <EvidenceChips items={t.evidence} />
                      <div style={{ marginTop: "auto" }}>
                        {logged.has(t.takeaway) ? (
                          <span className="pill good">✓ in your Ledger — {TEAM.scorekeeper.name} will check it</span>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => logPick(t)}>
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
