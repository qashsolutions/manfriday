"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "../app.module.css";

function hookOf(slots: Record<string, string>): string {
  return slots.hook ?? slots.hook_text ?? slots.hook_overlay ?? Object.values(slots)[0] ?? "";
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const FORMAT_LABEL: Record<string, string> = {
  slideshow: "SLIDESHOW",
  hook_video: "FACELESS",
  avatar: "AVATAR",
};

export default function PicksPage() {
  const feed = useQuery(api.feed.myFeed);
  const rendered = useQuery(api.feed.myRendered);
  const swipe = useMutation(api.feed.swipe);

  const top = feed?.concepts[0];

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") swipe({ conceptId: top.id, keep: true });
      if (e.key === "ArrowLeft") swipe({ conceptId: top.id, keep: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top, swipe]);

  if (feed === undefined) {
    return (
      <div className={styles.wrap}>
        <p className={styles.statusLine}>
          <span className={styles.pulse} /> Loading your feed…
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {top ? (
        <div className={styles.deck}>
          <span className={styles.trendChip}>
            <span className={styles.liveDot} />
            TREND REF · {fmtViews(top.refViews)} VIEWS · {FORMAT_LABEL[top.format] ?? top.format}
          </span>
          <div className={styles.card}>
            {top.thumbUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={top.thumbUrl} alt="" className={styles.cardImg} />
            )}
            <div className={styles.cardMeta}>
              <span className={styles.cardHook}>{hookOf(top.slots)}</span>
              <span className={styles.cardSub}>
                {FORMAT_LABEL[top.format]} · MADE FOR YOU · {top.language.toUpperCase()}
              </span>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.skipBtn} onClick={() => swipe({ conceptId: top.id, keep: false })}>
              ✕ Skip
            </button>
            <button type="button" className={styles.keepBtn} onClick={() => swipe({ conceptId: top.id, keep: true })}>
              Keep → Friday takes it from here
            </button>
          </div>
          <span className={styles.counter}>
            {feed.concepts.length} in the feed · {feed.kept} kept · ← → keys work too
          </span>
        </div>
      ) : (
        <>
          <p className="eyebrow">Picks</p>
          <h1 className={`display ${styles.title}`}>The feed is empty — for now.</h1>
          <p className={styles.sub}>
            {feed.kept > 0
              ? "You've swiped through everything. Friday drafts fresh concepts overnight — or point Friday at another product."
              : "Friday hasn't drafted anything for you yet. Hand over a URL and the first ten concepts arrive in minutes."}
          </p>
          <Link href="/onboarding" className="btn btn--accent">
            Put Friday to work →
          </Link>
        </>
      )}

      {rendered && rendered.length > 0 && (
        <>
          <span className={styles.sectionTitle}>RENDERED · READY TO POST (PUBLISHING ARRIVES WITH M3)</span>
          <div className={styles.renderedGrid}>
            {rendered.map((r) =>
              r.videoUrl ? (
                <div key={r.id} className={styles.renderedCard}>
                  <video src={r.videoUrl} controls playsInline preload="metadata" poster={r.thumbUrl ?? undefined} />
                </div>
              ) : null,
            )}
          </div>
        </>
      )}
    </div>
  );
}
