"use client";

import Link from "next/link";
import { atZero } from "@/lib/billing-copy";
import { useBilling } from "./useBilling";
import styles from "./OutOfVideosSheet.module.css";

/** Shown instead of a keep when no videos are left. The user can always close
 *  it and keep skipping — browsing Picks never costs anything. */
export function OutOfVideosSheet({ reason, onClose }: { reason: string; onClose: () => void }) {
  const { billing, busy, error, checkout, portal } = useBilling();
  const copy = atZero(reason, billing ?? null);
  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="zero-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="zero-title" className={styles.title}>{copy.title}</h2>
        <p className={styles.body}>{copy.body}</p>
        <div className={styles.actions}>
          {copy.actions.map((a) => {
            const key = "lookupKey" in a ? a.lookupKey : "portal";
            return (
              <button
                key={key}
                type="button"
                className={styles.action}
                data-primary={a.primary ? "true" : "false"}
                disabled={busy !== null}
                onClick={() => ("lookupKey" in a ? checkout(a.lookupKey) : portal())}
              >
                {busy === key ? "Opening secure checkout…" : a.label}
              </button>
            );
          })}
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.fine}>
          Quarterly, annual and Founding 200 prices are in <Link href="/settings#s-plan">Settings</Link>.
        </p>
        <button type="button" className={styles.close} onClick={onClose}>
          Not now, keep browsing
        </button>
      </div>
    </div>
  );
}
