"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";
import { Md } from "@/components/Md";
import { proseBuffer, readAnalystStream, Working } from "@/components/Working";
import { ConfidenceBar, EvidenceChips, type EvidenceItem } from "@/components/Verdict";
import { TEAM, sentenceCase } from "@/lib/team";

type Idea = { id: string; created_at: string; recommendation: string; notes: string | null; status: string; confidence: number | null; evidence: EvidenceItem[] | null };

export default function IdeasPage() {
  const supabase = supabaseBrowser();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [mining, setMining] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stages, setStages] = useState<string[]>([]);
  const [prose, setProse] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("recommendations")
      .select("id,created_at,recommendation,notes,status,confidence,evidence")
      .eq("target_type", "idea")
      .order("created_at", { ascending: false })
      .limit(50);
    setIdeas((data as Idea[] | null) ?? []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  type Mined = { summary: string; found: number; added: number };

  async function mine() {
    setErr(null);
    setNote(null);
    setMining(true);
    setProse("");
    setStages([`${sentenceCase(TEAM.listener.name)} is opening your comments…`]);
    const prose = proseBuffer((add) => setProse((p) => p + add));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/ideas", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "The comment read couldn't finish.");
      }
      if (!r.body) throw new Error("The comment read couldn't finish.");

      let j: Mined | null = null;
      for await (const ev of readAnalystStream<Mined>(r.body)) {
        if (ev.t === "stage") setStages((s) => [...s, ev.m]);
        else if (ev.t === "prose") prose.push(ev.d);
        else if (ev.t === "error") throw new Error(ev.error);
        else if (ev.t === "done") j = ev;
      }
      prose.flush();
      if (!j) throw new Error("The comment read stopped before it finished — try again.");

      setNote(
        j.added > 0
          ? `${j.added} new idea${j.added === 1 ? "" : "s"} from your comments.`
          : "Nothing new this time — every ask your viewers made is already on this list."
      );
      await load();
    } catch (e) {
      setProse(""); // a half-written read next to an error only confuses
      setErr(e instanceof Error ? e.message : "The comment read couldn't finish.");
    } finally {
      setMining(false);
    }
  }

  if (ideas === null) return <div className="quiet">Loading…</div>;

  return (
    <>
      <div className="pagehead">
        <h1>Your idea list</h1>
        {ideas.length > 0 && (
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={mine} disabled={mining}>
            {mining ? "Reading your comments…" : "Read my comments again"}
          </button>
        )}
      </div>
      {err && (
        <div className="err">
          {err}
          {err.includes("No comments") && (
            <>
              {" "}Meanwhile, <Link href="/scout" style={{ color: "inherit", textDecoration: "underline" }}>Compare with any video</Link>{" "}
              reads the comments on any public video — asks and all.
            </>
          )}
        </div>
      )}
      {note && <div className="ok-note">{note}</div>}
      {(mining || prose) && (
        <div className="card" style={{ marginBottom: 12 }}>
          {mining && <Working stages={stages} />}
          {prose && (
            <div style={mining ? { marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 } : undefined}>
              <Md md={prose} />
            </div>
          )}
        </div>
      )}
      {ideas.length === 0 ? (
        <div className="empty" style={{ padding: 40 }}>
          <b>Ideas come from your own comments</b>
          {sentenceCase(TEAM.listener.name)} reads what your viewers write and pulls out what they&apos;re literally
          asking you to make — every idea with a receipt: how many asked, and the actual comment.
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-acc btn-lg" onClick={mine} disabled={mining}>
              {mining ? "Reading your comments…" : "Read my comments"}
            </button>
          </div>
          <div style={{ maxWidth: 520, margin: "18px auto 0", textAlign: "left" }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink3)", fontWeight: 700, marginBottom: 6 }}>
              Sample — how an idea reads
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "12px 14px", background: "var(--card)" }}>
              <b style={{ fontSize: 13.5 }}>The $100 setup I wish I started with</b>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 6px" }}>
                <span className="pill acc">31 people asked</span>
                <span className="pill mut">receipt attached</span>
              </div>
              <div style={{ color: "var(--ink2)", fontSize: 12 }}>
                &quot;what would you buy first at $100?&quot; — your top comment on this topic, 214 likes
              </div>
            </div>
            <Explain
              why="Guessing what to make next is the most expensive mistake on a channel."
              how="Requests are counted across your real comments — each idea keeps its receipt."
              what="Make the #1 — then the Scorekeeper checks whether it beat your normal."
            />
          </div>
        </div>
      ) : (
        <div className="card">
          {ideas.map((idea, i) => (
            <div key={idea.id} style={{ display: "flex", gap: 12, padding: "11px 4px", borderTop: i ? "1px solid var(--line2)" : "none" }}>
              <span className="num" style={{ color: "var(--ink3)", fontSize: 12, width: 22 }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13.5 }}>{idea.recommendation}</b>
                {idea.notes && <div style={{ color: "var(--ink2)", fontSize: 12.5 }}>{idea.notes}</div>}
                {(idea.confidence !== null || idea.evidence?.length) && (
                  <div style={{ display: "grid", gap: 6, marginTop: 8, maxWidth: 420 }}>
                    {idea.confidence !== null && <ConfidenceBar value={idea.confidence} />}
                    {idea.evidence && <EvidenceChips items={idea.evidence} />}
                  </div>
                )}
              </div>
              <span className={`pill ${idea.status === "open" ? "acc" : "mut"}`}>{idea.status}</span>
            </div>
          ))}
          <Explain
            why="These aren't guesses — each one is something your viewers asked for in writing."
            how={`${sentenceCase(TEAM.listener.name)} counts requests across your real comments; the receipt rides along.`}
            what="Make the top one next — mark it applied and the Scorekeeper checks the outcome."
          />
        </div>
      )}
    </>
  );
}
