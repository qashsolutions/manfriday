"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "../app.module.css";

const STATUS_COLOR: Record<string, string> = {
  queued: "var(--amber)",
  publishing: "var(--amber)",
  live: "var(--mint)",
  draft_fallback: "var(--mint)",
  failed: "var(--accent)",
};

/** Turn an adapter error code into one plain sentence the user can act on. */
function friendlyError(platform: string, error: string | null): string | null {
  if (!error) return null;
  const name = platform === "youtube" ? "YouTube" : "TikTok";
  if (error.startsWith("AUTH_EXPIRED")) return `${name} access expired before this post went out — reconnect in Settings, then schedule it again.`;
  if (/quota/i.test(error)) return `${name} upload limit reached for today — Friday will not retry on its own; schedule it again tomorrow.`;
  if (/too large|413|duration/i.test(error)) return `${name} rejected the video file — try a shorter concept.`;
  return `${name} didn't accept this post — Friday will not retry on its own; schedule it again or contact support.`;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "QUEUED",
  publishing: "PUBLISHING…",
  live: "LIVE",
  draft_fallback: "IN YOUR TIKTOK INBOX",
  failed: "FAILED",
};

function fridaySuggests(): string {
  // Friday suggests 17:30 local, tomorrow if 17:30 already passed (lookup-table
  // best-time heuristics replace this in M4)
  const d = new Date();
  d.setHours(17, 30, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CalendarPage() {
  const queue = useQuery(api.publishing.myQueue);
  const rendered = useQuery(api.feed.myRendered);
  const accounts = useQuery(api.oauth.myAccounts);
  const schedule = useMutation(api.publishing.schedulePost);
  const [when, setWhen] = useState(fridaySuggests());
  const [error, setError] = useState<string | null>(null);

  const tiktokConnected = accounts?.some((a) => a.platform === "tiktok" && a.status === "connected");
  const youtubeConnected = accounts?.some((a) => a.platform === "youtube" && a.status === "connected");
  const anyConnected = !!(tiktokConnected || youtubeConnected);
  // A platform whose access stopped working — the user needs to know posting is paused there.
  const expired = (accounts ?? []).filter((a) => a.status === "expired").map((a) => (a.platform === "youtube" ? "YouTube" : "TikTok"));
  // feed.myRendered already excludes concepts that have a post (they live in the queue below).
  const unscheduled = rendered ?? [];

  const onSchedule = async (conceptId: (typeof unscheduled)[number]["id"]) => {
    setError(null);
    try {
      await schedule({ conceptId, publishAt: new Date(when).getTime() });
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*Error: /, "") : "Couldn't schedule");
    }
  };

  return (
    <div className={styles.wrap}>
      <p className="eyebrow">Friday&apos;s queue</p>
      <h1 className={`display ${styles.title}`}>Calendar</h1>

      {!anyConnected && (
        <p className={styles.sub}>
          Friday can&apos;t post anywhere yet —{" "}
          <Link href="/settings">connect TikTok or YouTube in Settings</Link> first.
        </p>
      )}
      {expired.length > 0 && (
        <p className={styles.error}>
          {expired.join(" and ")} access expired, so posting there is paused.{" "}
          <Link href="/settings">Reconnect in Settings</Link> to keep posting.
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {unscheduled.length > 0 && anyConnected && (
        <>
          <span className={styles.sectionTitle}>READY TO SCHEDULE</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <label className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>
              FRIDAY SUGGESTS
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                style={{
                  display: "block",
                  marginTop: 6,
                  background: "var(--panel)",
                  color: "var(--ink)",
                  border: "1px solid var(--edge-2)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                }}
              />
            </label>
          </div>
          <div className={styles.renderedGrid}>
            {unscheduled.map((r) => (
              <div key={r.id} className={styles.renderedCard} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {r.videoUrl && <video src={r.videoUrl} controls playsInline preload="metadata" poster={r.thumbUrl ?? undefined} />}
                <button type="button" className={styles.keepBtn} style={{ padding: "10px 0", fontSize: 13.5 }} onClick={() => onSchedule(r.id)}>
                  Schedule →
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <span className={styles.sectionTitle}>THE QUEUE</span>
      {queue === undefined ? (
        <p className={styles.statusLine}>
          <span className={styles.pulse} /> Loading…
        </p>
      ) : queue.length === 0 ? (
        <div className={styles.stub}>
          Nothing scheduled yet. Right-swipe in Picks, then schedule the rendered videos here —
          Friday handles the posting.
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 10 }}>
          {queue.map((post) => (
            <div
              key={post.id}
              className="panel"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 20px" }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {post.hook || "(untitled concept)"}
                </p>
                <p className="mono" style={{ margin: "3px 0 0", fontSize: 11, color: "var(--faint)" }}>
                  {new Date(post.publishAt).toLocaleString()}
                </p>
                {post.publications
                  .filter((p) => p.status === "failed")
                  .map((p) => (
                    <p key={`${p.id}-why`} style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--accent)", whiteSpace: "normal" }}>
                      {friendlyError(p.platform, p.error)}{" "}
                      {p.error?.startsWith("AUTH_EXPIRED") && <Link href="/settings">Reconnect →</Link>}
                    </p>
                  ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {post.publications.map((p) => (
                  <span
                    key={p.id}
                    className="mono"
                    title={p.error ?? undefined}
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      color: STATUS_COLOR[p.status] ?? "var(--dim)",
                      border: `1px solid ${STATUS_COLOR[p.status] ?? "var(--edge-2)"}`,
                      borderRadius: 999,
                      padding: "3px 10px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.platform.toUpperCase()} · {STATUS_LABEL[p.status] ?? p.status}
                    {p.views !== null && p.status === "live" ? ` · ${p.views.toLocaleString()} VIEWS` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
