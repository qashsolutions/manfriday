"use client";

import { useState } from "react";

/** One-line why/how/what caption under a visual. Keep each part to a phrase. */
export function Explain({ why, how, what }: { why?: string; how?: string; what?: string }) {
  const Item = ({ label, text }: { label: string; text?: string }) =>
    text ? (
      <span style={{ marginRight: 16 }}>
        <b style={{ color: "var(--ink2)", fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</b>{" "}
        <span style={{ color: "var(--ink3)" }}>{text}</span>
      </span>
    ) : null;
  return (
    <div style={{ fontSize: 12, lineHeight: 1.7, marginTop: 10, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
      <Item label="Why" text={why} />
      <Item label="How" text={how} />
      <Item label="What now" text={what} />
    </div>
  );
}

/** Honesty affordance: every analyst read carries a way to flag a bad claim. */
export function WrongClaim({ context }: { context: string }) {
  return (
    <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--ink3)" }}>
      Spot a claim that&apos;s wrong?{" "}
      <a
        href={`mailto:hello@manfriday.app?subject=${encodeURIComponent(`Wrong claim: ${context}`)}`}
        style={{ color: "var(--acc)" }}
      >
        Tell us
      </a>{" "}
      — honest reads are the product.
    </p>
  );
}

/** Video thumbnail with a quiet fallback block — also used when the image
    fails to load (private videos only get short-lived preview URLs from
    YouTube; they refresh with the daily data pull). */
export function Thumb({ url, alt }: { url: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const base: React.CSSProperties = {
    width: 66, height: 37, borderRadius: 5, flex: "none", objectFit: "cover",
    background: "var(--line2)", display: "block",
  };
  if (!url || broken) return <span style={base} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} style={base} loading="lazy" onError={() => setBroken(true)} />;
}

/** The lesson pointer: which videos to study, which to fix. That's the ONLY
    job of this column — routing the creator to the reads that grow the next
    video's views. When numbers are too small to point at lessons (muted),
    it says the plain facts instead of pretending to judge. */
export function RatioBar({ ratio, muted, views, usual }: {
  ratio: number | null; muted?: boolean; views?: number | null; usual?: number | null;
}) {
  if (ratio === null) return <span style={{ color: "var(--ink3)" }}>—</span>;
  if (muted) {
    return (
      <span style={{ fontSize: 12, color: "var(--ink3)" }}>
        {views ?? "—"} {views === 1 ? "view" : "views"} vs your usual {usual ?? "—"}
      </span>
    );
  }
  const label =
    ratio >= 2 ? "did something right — study it"
    : ratio <= 0.5 ? "fell short — find out why"
    : "typical for you";
  const color = ratio >= 2 ? "var(--good)" : ratio <= 0.5 ? "var(--crit)" : "var(--ink2)";
  const max = 3;
  const pct = Math.min(ratio, max) / max * 100;
  const normalPct = (1 / max) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }} title={`${views ?? "?"} views vs your usual ${usual ?? "?"}`}>
      <div style={{ position: "relative", flex: 1, minWidth: 50, height: 6, borderRadius: 3, background: "var(--line2)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 3, background: color }} />
        <div title="your usual" style={{ position: "absolute", left: `${normalPct}%`, top: -2, bottom: -2, width: 2, background: "var(--ink3)", opacity: .6 }} />
      </div>
      <span style={{ fontSize: 11.5, color, whiteSpace: "nowrap", fontWeight: 600 }}>{label}</span>
    </div>
  );
}
