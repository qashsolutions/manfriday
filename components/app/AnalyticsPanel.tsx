"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "../../app/(app)/app.module.css";

const n = (v: number | null) => (v === null ? "—" : v.toLocaleString());
const delta = (v: number | null) => (v === null ? "" : v >= 0 ? `+${v.toLocaleString()} / 7d` : `${v.toLocaleString()} / 7d`);

/** Plain stats (determinism-first): what each published post did, clicks first
 *  when there is a tracked link, views last. Counts come from a once-a-day
 *  YouTube refresh; nothing is fetched on page load. */
export function AnalyticsPanel() {
  const data = useQuery(api.stats.myAnalytics);
  if (data === undefined) {
    return (
      <p className={styles.statusLine}>
        <span className={styles.pulse} /> Loading…
      </p>
    );
  }
  if (data === null) return <div className={styles.stub}>Sign in to see how your posts did.</div>;
  const published = data.rows.filter((r) => r.platforms.some((p) => p.status === "live"));
  if (published.length === 0) {
    return (
      <div className={styles.stub}>
        Nothing published yet. Once a Short is live, its views land here every morning —{" "}
        <Link href="/calendar">schedule one from the Calendar</Link>.
      </div>
    );
  }
  const updated = data.lastCapturedAt ? new Date(data.lastCapturedAt).toLocaleString() : null;
  return (
    <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {[
          ["CLICKS TO YOUR PRODUCT", n(data.totals.clicks)],
          ["VIEWS", n(data.totals.views)],
          ["LIKES", n(data.totals.likes)],
        ].map(([label, value]) => (
          <div key={label} className="panel" style={{ padding: "14px 18px" }}>
            <p className="mono" style={{ margin: 0, fontSize: 10, letterSpacing: "0.1em", color: "var(--faint)" }}>{label}</p>
            <p className="display" style={{ margin: "6px 0 0", fontSize: 26 }}>{value}</p>
          </div>
        ))}
      </div>
      <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--faint)" }}>
        {updated ? `YOUTUBE COUNTS UPDATED ${updated.toUpperCase()} · REFRESHED ONCE A DAY` : "FIRST YOUTUBE REFRESH LANDS TOMORROW MORNING"}
        {" · TIKTOK COUNTS COMING AFTER ITS API REVIEW"}
      </p>
      <span className={styles.sectionTitle}>BY POST</span>
      {published.map((r) => (
        <div key={r.id} className="panel" style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.hook}</p>
            <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap" }}>{new Date(r.publishAt).toLocaleDateString()}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 13 }}>
            <span><strong>{r.hasLink ? n(r.clicks) : "—"}</strong> <span style={{ color: "var(--dim)" }}>clicks{r.hasLink ? "" : " (no tracked link)"}</span></span>
            {r.platforms.filter((p) => p.status === "live").map((p) => (
              <span key={p.id}>
                <strong>{n(p.views)}</strong> <span style={{ color: "var(--dim)" }}>views</span>
                {p.viewsDelta7d !== null && <span className="mono" style={{ color: "var(--mint)", fontSize: 11, marginLeft: 6 }}>{delta(p.viewsDelta7d)}</span>}
                {" · "}<strong>{n(p.likes)}</strong> <span style={{ color: "var(--dim)" }}>likes</span>
                {" · "}<strong>{n(p.comments)}</strong> <span style={{ color: "var(--dim)" }}>comments</span>
                {p.url && (
                  <>
                    {" · "}
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11 }}>
                      {p.platform.toUpperCase()} ↗
                    </a>
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
