"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

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
