"use client";

import { useEffect, useRef, useState } from "react";
import { useReportItem } from "@/lib/report-context";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "../app.module.css";
import { AlsoInSheet } from "@/components/app/AlsoInSheet";
import { OutOfVideosSheet } from "@/components/app/OutOfVideosSheet";
import { parseBillingError, type BillingView } from "@/lib/billing-copy";
import { languageMeta, styleLabel } from "@/lib/languages";
import { WhySheet, WordsSheet } from "@/components/app/PickSheets";
import { compact, outlierLine, spaceName } from "@/lib/pick-why";

function hookOf(slots: Record<string, string>): string {
  return slots.hook ?? slots.hook_text ?? slots.hook_overlay ?? Object.values(slots)[0] ?? "";
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
  const editWords = useMutation(api.feed.editWords);
  const [sheet, setSheet] = useState<"why" | "words" | null>(null);
  // Phone: drag the card right to keep, left to skip.
  const drag = useRef<{ x: number; id: string } | null>(null);
  const [dx, setDx] = useState(0);
  // Language UX §2: after a keep, offer the same pick in another market.
  const [alsoIn, setAlsoIn] = useState<{ id: (typeof feed extends undefined ? never : NonNullable<typeof feed>)["concepts"][number]["id"]; language: string; languageStyle: "code-mixed" | "native" | "roman" | null; hook: string } | null>(null);

  const billing = useQuery(api.billing.myBilling) as BillingView | null | undefined;
  const me = useQuery(api.users.current);
  // D5: a keep costs one video. At zero the keep opens a choice instead; skipping stays free.
  const [outOf, setOutOf] = useState<string | null>(null);

  const top = feed?.concepts[0];
  // "Something wrong?" sends which pick was on screen.
  useReportItem(top ? { kind: "pick", id: top.id, label: hookOf(top.slots).slice(0, 80) } : null);

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
      if (alsoIn || outOf || sheet) return; // an open sheet owns the keyboard
      if (e.key === "ArrowRight") void keep(top);
      if (e.key === "ArrowLeft") swipe({ conceptId: top.id, keep: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, swipe, alsoIn, outOf, sheet]);

  const SWIPE_AT = 90;
  const onPointerDown = (e: React.PointerEvent) => {
    if (!top || e.pointerType === "mouse") return; // desktop has buttons and keys
    drag.current = { x: e.clientX, id: top.id };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) setDx(e.clientX - drag.current.x);
  };
  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    const moved = dx;
    setDx(0);
    if (!d || !top || d.id !== top.id) return;
    if (moved > SWIPE_AT) void keep(top);
    else if (moved < -SWIPE_AT) void swipe({ conceptId: top.id, keep: false });
  };

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
          <button type="button" className={styles.trendChip} onClick={() => setSheet("why")} data-elsewhere={top.why ? !top.why.fromYourSpace : undefined}>
            <span className={styles.liveDot} />
            {top.why?.refViews
              ? `TREND · ${compact(top.why.refViews)} VIEWS${outlierLine(top.why.outlierX) ? ` · ${Math.round(top.why.outlierX!)}× USUAL` : ""}`
              : "PROVEN SHAPE"}
            {top.why && !top.why.fromYourSpace ? ` · FROM ${spaceName(top.why.trendSpace).toUpperCase()}` : ""}
            <span className={styles.whyLink}>WHY?</span>
          </button>
          <div
            className={styles.card}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 25}deg)`, transition: "none" } : undefined}
            data-intent={dx > SWIPE_AT ? "keep" : dx < -SWIPE_AT ? "skip" : undefined}
          >
            {top.thumbUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={top.thumbUrl} alt="" className={styles.cardImg} />
            )}
            <div className={styles.cardMeta}>
              {/* The thumbnail already carries the hook, burned in by the render
                  worker. Repeating it here printed the line twice, the overlay
                  ghosting over the baked-in text. Show it only when there is no
                  thumbnail to read it from. */}
              {!top.thumbUrl && <span className={styles.cardHook}>{hookOf(top.slots)}</span>}
              {!top.thumbUrl && <span className={styles.cardSub}>REDRAWING THE PREVIEW…</span>}
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
              {billing && billing.remaining === 0
                ? "Keep → out of videos"
                : me?.autoSchedule === false
                  ? "Keep → Friday renders it"
                  : "Keep → Friday schedules it"}
            </button>
          </div>
          {top.words.length > 0 && (
            <button type="button" className={styles.editLink} onClick={() => setSheet("words")}>
              Edit the words before keeping
            </button>
          )}
          <span className={styles.counter}>
            {me?.autoSchedule === false ? "Renders land in Calendar" : "Kept videos post at 17:30, one a day"} ·{" "}
            {feed.concepts.length} in the feed · {feed.kept} kept
            {billing ? ` · ${billing.remaining} ${billing.remaining === 1 ? "video" : "videos"} left` : ""}
            <span className={styles.keysHint}> · ← → keys work too</span>
            <span className={styles.swipeHint}> · swipe the card: right keeps, left skips</span>
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
                  ? "You've swiped through everything. Give Friday your URL again for ten fresh picks — previews are free."
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

      {top && sheet === "why" && top.why && <WhySheet why={top.why} onClose={() => setSheet(null)} />}
      {top && sheet === "words" && (
        <WordsSheet
          key={top.id}
          words={top.words}
          onSave={async (slots) => {
            await editWords({ conceptId: top.id, slots });
          }}
          onClose={() => setSheet(null)}
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
