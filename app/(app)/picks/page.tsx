"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "../app.module.css";
import { AlsoInSheet } from "@/components/app/AlsoInSheet";
import { OutOfVideosSheet } from "@/components/app/OutOfVideosSheet";
import { parseBillingError, type BillingView } from "@/lib/billing-copy";
import { languageMeta, styleLabel } from "@/lib/languages";

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
  const brand = useQuery(api.brands.myBrand);
  const swipe = useMutation(api.feed.swipe);
  const requestVariant = useMutation(api.feed.requestVariant);
  // Language UX §2: after a keep, offer the same pick in another market.
  const [alsoIn, setAlsoIn] = useState<{ id: (typeof feed extends undefined ? never : NonNullable<typeof feed>)["concepts"][number]["id"]; language: string; languageStyle: "code-mixed" | "native" | "roman" | null; hook: string } | null>(null);

  const billing = useQuery(api.billing.myBilling) as BillingView | null | undefined;
  // D5: a keep costs one video. At zero the keep opens a choice instead; skipping stays free.
  const [outOf, setOutOf] = useState<string | null>(null);

  const top = feed?.concepts[0];

  const keep = async (c: NonNullable<typeof top>) => {
    try {
      await swipe({ conceptId: c.id, keep: true });
    } catch (err) {
      const b = parseBillingError(err);
      if (b?.kind === "ALLOWANCE") return setOutOf(b.reason);
      throw err;
    }
    if (!c.variantOf) setAlsoIn({ id: c.id, language: c.language, languageStyle: c.languageStyle, hook: hookOf(c.slots) });
  };

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (alsoIn || outOf) return; // an open sheet owns the keyboard
      if (e.key === "ArrowRight") void keep(top);
      if (e.key === "ArrowLeft") swipe({ conceptId: top.id, keep: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, swipe, alsoIn, outOf]);

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
                {FORMAT_LABEL[top.format]} · MADE FOR YOU ·{" "}
                <span lang={top.language}>{languageMeta(top.language).native}</span>
                {styleLabel(top.language, top.languageStyle) ? ` · ${styleLabel(top.language, top.languageStyle)?.toUpperCase()}` : ""}
                {top.variantOf ? " · ALSO-IN VARIANT" : ""}
              </span>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.skipBtn} onClick={() => swipe({ conceptId: top.id, keep: false })}>
              ✕ Skip
            </button>
            <button type="button" className={styles.keepBtn} onClick={() => void keep(top)}>
              {billing && billing.remaining === 0 ? "Keep → out of videos" : "Keep → Friday takes it from here"}
            </button>
          </div>
          <span className={styles.counter}>
            {feed.concepts.length} in the feed · {feed.kept} kept
            {billing ? ` · ${billing.remaining} ${billing.remaining === 1 ? "video" : "videos"} left` : ""} · ← → keys work too
          </span>
        </div>
      ) : (
        <>
          <p className="eyebrow">Picks</p>
          {feed.pending > 0 ? (
            <>
              {/* Drafts exist but their previews are still rendering — not an empty state. */}
              <h1 className={`display ${styles.title}`}>Friday is rendering your previews.</h1>
              <p className={styles.sub}>
                {feed.pending} {feed.pending === 1 ? "concept is" : "concepts are"} in the render
                queue. They appear here as they finish, usually within a few minutes. This page
                updates on its own.
              </p>
              <p className={styles.statusLine}>
                <span className={styles.pulse} /> Rendering…
              </p>
            </>
          ) : (
            <>
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
        </>
      )}

      {alsoIn && (
        <AlsoInSheet
          primary={alsoIn.language}
          primaryStyle={alsoIn.languageStyle}
          markets={brand?.markets ?? null}
          hook={alsoIn.hook}
          onAdd={async (language) => {
            const style = languageMeta(language).indic ? ("code-mixed" as const) : undefined;
            try {
              await requestVariant({ conceptId: alsoIn.id, language, languageStyle: style });
            } catch (err) {
              const b = parseBillingError(err);
              if (b?.kind === "ALLOWANCE") {
                setAlsoIn(null);
                setOutOf(b.reason);
                return;
              }
              throw err;
            }
          }}
          onClose={() => setAlsoIn(null)}
        />
      )}

      {outOf && <OutOfVideosSheet reason={outOf} onClose={() => setOutOf(null)} />}

      {rendered && rendered.length > 0 && (
        <>
          <span className={styles.sectionTitle}>RENDERED · SCHEDULE THEM IN CALENDAR</span>
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
