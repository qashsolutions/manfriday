"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Explain } from "@/components/Explain";
import { Md } from "@/components/Md";

type Report = { id: string; created_at: string; agent: string; title: string; body_md: string };

export default function ReportsPage() {
  const supabase = supabaseBrowser();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("reports")
      .select("id,created_at,agent,title,body_md")
      .order("created_at", { ascending: false })
      .limit(50);
    setReports((data as Report[] | null) ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function writeReport() {
    setErr(null);
    setWriting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/weekly", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The report couldn't be written.");
      await load();
      setOpenId(j.report?.id ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The report couldn't be written.");
    } finally {
      setWriting(false);
    }
  }

  if (reports === null) return <div className="quiet">Loading…</div>;

  return (
    <>
      <div className="pagehead">
        <h1>Reports</h1>
        {reports.length > 0 && (
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={writeReport} disabled={writing}>
            {writing ? "Writing…" : "Write this week's report"}
          </button>
        )}
      </div>
      {err && <div className="err">{err}</div>}
      {reports.length === 0 ? (
        <div className="empty" style={{ padding: 40 }}>
          <b>Your week in review, on demand</b>
          The team&apos;s report — your numbers, what they did, and the one thing that needs
          you — written from your real data in about a minute.
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-acc btn-lg" onClick={writeReport} disabled={writing}>
              {writing ? "Writing your report…" : "Write my first report"}
            </button>
          </div>
          <div style={{ maxWidth: 440, margin: "18px auto 0", textAlign: "left" }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink3)", fontWeight: 700, marginBottom: 6 }}>
              Sample — a report&apos;s three parts
            </div>
            {[
              ["Your numbers", "views, watch hours, subscribers — all vs last week, one denominator"],
              ["What your team did", "tips checked, comments read, competitors watched"],
              ["Needs you (kept to one)", "a single decision or package — never a to-do list"],
            ].map(([t, d]) => (
              <div key={t} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "9px 12px", background: "var(--card)", marginBottom: 6 }}>
                <b style={{ fontSize: 12.5 }}>{t}</b>
                <div style={{ color: "var(--ink2)", fontSize: 12 }}>{d}</div>
              </div>
            ))}
            <Explain
              why="Accountability that shows up on schedule — whether or not you do."
              how="Written weekly from your real numbers; every claim traceable to the data."
              what="Read it in two minutes, act on the one thing that needs you."
            />
          </div>
        </div>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {reports.map((r) => (
            <div className="card" key={r.id}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, cursor: "pointer" }}
                   onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <b style={{ fontSize: 14 }}>{r.title}</b>
                <span style={{ color: "var(--ink3)", fontSize: 12 }}>
                  {r.agent} · {new Date(r.created_at).toLocaleDateString()}
                </span>
                <span style={{ marginLeft: "auto", color: "var(--acc)", fontSize: 12 }}>
                  {openId === r.id ? "close" : "read"}
                </span>
              </div>
              {openId === r.id && <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}><Md md={r.body_md} /></div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
