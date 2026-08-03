"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadChannelData } from "@/lib/channelData";

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
        </div>
      )}
    </>
  );
}
