"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadChannelData } from "@/lib/channelData";
import { Explain } from "@/components/Explain";

export default function PackagingPage() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    loadChannelData().then((d) => setReady(Boolean(d.baselines.longform || d.baselines.shorts)));
  }, []);

  if (ready === null) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;

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
        <div className="card">
          <span className="k">Your next upload&apos;s title</span>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Paste your draft title</span>
            <input
              className="input"
              placeholder="e.g. Building My Dream Workshop Storage (Part 3)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button className="btn btn-acc" disabled title="The Packaging Analyst comes online next">
            Grade it against my winners
          </button>
          <p style={{ color: "var(--ink2)", fontSize: 12.5, marginTop: 10 }}>
            The Packaging Analyst is the next team member to come online — grades will use your own
            winner patterns and what people really type into YouTube. Your baseline is already in place.
          </p>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink3)", fontWeight: 700, marginBottom: 8 }}>
              Sample — how a grade will read
            </div>
            <div className="grid g2">
              <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ width: 44, height: 44, borderRadius: 10, background: "var(--warn-soft)", color: "var(--warn)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800 }}>C</span>
                  <div>
                    <b style={{ fontSize: 13 }}>&quot;My Workshop Update (Part 3)&quot;</b>
                    <div style={{ color: "var(--ink2)", fontSize: 12 }}>Series-numbered, benefit-free — titles like this run below your normal.</div>
                  </div>
                </div>
              </div>
              <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ width: 44, height: 44, borderRadius: 10, background: "var(--good-soft)", color: "var(--good)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800 }}>A−</span>
                  <div>
                    <b style={{ fontSize: 13 }}>&quot;The $100 setup I wish I started with&quot;</b>
                    <div style={{ color: "var(--ink2)", fontSize: 12 }}>Matches what people type and your own winners&apos; patterns.</div>
                  </div>
                </div>
              </div>
            </div>
            <Explain
              why="A weak title kills a good video before anyone watches it."
              how="Drafts get graded against your own past winners and real search phrases — with the reason attached, never a bare score."
              what="Paste a draft above — grading goes live with the Packaging Analyst."
            />
          </div>
        </div>
      )}
    </>
  );
}
