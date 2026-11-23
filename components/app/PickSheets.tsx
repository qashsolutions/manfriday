"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { compact, outlierLine, patternWhy, PLATFORM_NAME, spaceName } from "@/lib/pick-why";
import styles from "./PickSheets.module.css";

export type PickWhy = {
  pattern: string;
  refHook: string | null;
  refConcept: string | null;
  refHandle: string | null;
  refUrl: string | null;
  refViews: number | null;
  refPlatform: string;
  outlierX: number | null;
  followers: number | null;
  fromYourSpace: boolean;
  trendSpace: string | null;
  yourSpace: string | null;
};

export type PickWord = { id: string; label: string; max: number; value: string };

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Why this pick could work: the real post it is modelled on, what that post
 *  did, why the shape holds attention, and whether it comes from the user's space. */
export function WhySheet({ why, onClose }: { why: PickWhy; onClose: () => void }) {
  useEscape(onClose);
  const shape = patternWhy(why.pattern);
  const beat = outlierLine(why.outlierX);
  const platform = PLATFORM_NAME[why.refPlatform] ?? why.refPlatform;
  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="why-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.grip} aria-hidden="true" />
        <div className={styles.body}>
          <div>
            <h2 id="why-title" className={styles.title}>
              Why this pick
            </h2>
            <p className={styles.sub}>
              Friday wrote it in the shape of a real post that already worked. Here is that post,
              and what the shape does for a viewer.
            </p>
          </div>

          {!why.fromYourSpace && (
            <p className={styles.note}>
              {why.yourSpace
                ? `Friday has no proven posts from ${spaceName(why.yourSpace)} yet, so this one comes from ${spaceName(why.trendSpace)}. The shape carries over; the audience is different.`
                : `This one comes from ${spaceName(why.trendSpace)}.`}{" "}
              <Link href="/settings#s-brief">Change your space</Link>
            </p>
          )}

          <div className={styles.block}>
            <p className={styles.label}>THE SHAPE · {shape.name.toUpperCase()}</p>
            <p className={styles.sub} style={{ color: "var(--ink)" }}>
              {shape.why}
            </p>
          </div>

          {why.refUrl ? (
            <div className={styles.block}>
              <p className={styles.label}>
                THE ORIGINAL{why.refHandle ? ` · @${why.refHandle.toUpperCase()}` : ""} · {platform.toUpperCase()}
                {why.fromYourSpace && why.trendSpace ? ` · ${spaceName(why.trendSpace).toUpperCase()}` : ""}
              </p>
              {why.refHook && <p className={styles.quote}>“{why.refHook}”</p>}
              {why.refConcept && (
                <p className={styles.sub} style={{ marginTop: 8 }}>
                  {why.refConcept}
                </p>
              )}
              <ul className={styles.facts} style={{ marginTop: 10 }}>
                {why.refViews ? <li className={styles.fact}>{compact(why.refViews)} views</li> : null}
                {beat ? <li className={styles.fact}>{beat}</li> : null}
                {why.followers ? <li className={styles.fact}>{compact(why.followers)} followers</li> : null}
              </ul>
              <a href={why.refUrl} target="_blank" rel="noopener noreferrer" className={styles.link} style={{ marginTop: 10 }}>
                Watch the original on {platform} ↗
              </a>
            </div>
          ) : (
            <p className={styles.sub}>
              This is one of Friday&apos;s starter shapes, built from the pattern rather than one
              linked post, so there are no numbers to show for it.
            </p>
          )}

          <p className={styles.sub} style={{ fontSize: 12.5 }}>
            A shape that worked for someone else is a good bet, not a promise. Your Analytics
            shows what actually sends people to your product.
          </p>
        </div>
        <div className={styles.row}>
          <button type="button" className={styles.ghost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Edit a pick's words before keeping it. Nothing posts in the user's name
 *  that they can't change first. */
export function WordsSheet({
  words,
  onSave,
  onClose,
}: {
  words: PickWord[];
  onSave: (slots: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  useEscape(onClose);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(words.map((w) => [w.id, w.value])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = words.some((w) => !draft[w.id]?.trim() || draft[w.id].trim().length > w.max);
  const changed = words.filter((w) => draft[w.id].trim() !== w.value);

  const save = async () => {
    if (invalid || busy) return;
    if (changed.length === 0) return onClose();
    setBusy(true);
    setError(null);
    try {
      await onSave(Object.fromEntries(changed.map((w) => [w.id, draft[w.id].trim()])));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*(Uncaught Error|ConvexError): /, "").split("\n")[0] : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="words-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.grip} aria-hidden="true" />
        <div className={styles.body}>
          <div>
            <h2 id="words-title" className={styles.title}>
              Edit the words
            </h2>
            <p className={styles.sub}>
              This goes out in your name, so make every line true for your product. Friday redraws
              the preview, and the video is made from these words when you keep it.
            </p>
          </div>
          {words.map((w) => {
            const len = draft[w.id]?.trim().length ?? 0;
            const long = w.max > 120;
            return (
              <label key={w.id} className={styles.field}>
                <span className={styles.fieldHead}>
                  <span className={styles.fieldLabel}>{w.label}</span>
                  <span className={styles.count} data-over={len > w.max}>
                    {len}/{w.max}
                  </span>
                </span>
                <textarea
                  className={styles.input}
                  rows={long ? 5 : 2}
                  value={draft[w.id]}
                  onChange={(e) => setDraft((d) => ({ ...d, [w.id]: e.target.value }))}
                />
              </label>
            );
          })}
          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={styles.row}>
          <button type="button" className={styles.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.primary} disabled={invalid || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save words"}
          </button>
        </div>
      </div>
    </div>
  );
}
