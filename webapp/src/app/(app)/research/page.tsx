"use client";

import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";
import { Md } from "@/components/Md";

type Report = { id: string; title: string; body_md: string; created_at: string };

export default function ResearchPage() {
  const supabase = supabaseBrowser();
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function research() {
    setErr(null);
    setWorking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/research", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ query }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The research couldn't finish.");
      setReport(j.report);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The research couldn't finish.");
    } finally {
      setWorking(false);
    }
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
          what="Read the angles, pick one that fits you — the report is saved with your weekly reports."
        />
      </div>

      {report && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 14 }}>{report.title}</b>
            <span style={{ color: "var(--ink3)", fontSize: 12 }}>
              The Researcher · {new Date(report.created_at).toLocaleDateString()}
            </span>
            <Link href="/reports" style={{ marginLeft: "auto", color: "var(--acc)", fontSize: 12 }}>
              saved with your reports →
            </Link>
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}>
            <Md md={report.body_md} />
          </div>
        </div>
      )}
    </>
  );
}
