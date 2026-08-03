"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";

type Idea = { id: string; created_at: string; recommendation: string; notes: string | null; status: string };

export default function IdeasPage() {
  const supabase = supabaseBrowser();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);

  useEffect(() => {
    supabase
      .from("recommendations")
      .select("id,created_at,recommendation,notes,status")
      .eq("target_type", "idea")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }: { data: Idea[] | null }) => setIdeas(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (ideas === null) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;

  return (
    <>
      <div className="pagehead"><h1>Your idea list</h1></div>
      {ideas.length === 0 ? (
        <div className="empty" style={{ padding: 40 }}>
          <b>Ideas arrive once the Audience Analyst reads your comments</b>
          Every idea comes with receipts — how many viewers asked, the actual comment, and what
          the team expects it to do against your normal. That analyst comes online next.
          <div style={{ maxWidth: 520, margin: "18px auto 0", textAlign: "left" }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink3)", fontWeight: 700, marginBottom: 6 }}>
              Sample — how an idea reads
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "12px 14px", background: "var(--card)" }}>
              <b style={{ fontSize: 13.5 }}>The $100 setup I wish I started with</b>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 6px" }}>
                <span className="pill acc">31 people asked</span>
                <span className="pill good">many people search this</span>
                <span className="pill mut">≈ 2× your normal</span>
              </div>
              <div style={{ color: "var(--ink2)", fontSize: 12 }}>
                &quot;what would you buy first at $100?&quot; — your top comment on this topic, 214 likes
              </div>
            </div>
            <Explain
              why="Guessing what to make next is the most expensive mistake on a channel."
              how="Requests are counted across your real comments and checked against what people type into YouTube."
              what="Make the #1 — then the Scorekeeper checks whether the estimate was honest."
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
              </div>
              <span className={`pill ${idea.status === "open" ? "acc" : "mut"}`}>{idea.status}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
