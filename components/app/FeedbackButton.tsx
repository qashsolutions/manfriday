"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { parseBillingError } from "@/lib/billing-copy";
import { deviceLabel, installErrorCapture, snapshot, type ReportContext } from "@/lib/report-context";
import styles from "./FeedbackButton.module.css";

/** Always-available "something's wrong" button. Goes straight to the operators:
 *  stored in the database and emailed, so a tester never has to find our address. */
export function FeedbackButton() {
  const pathname = usePathname();
  const submit = useMutation(api.feedback.submit);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<ReportContext | null>(null);
  useEffect(() => installErrorCapture(), []);
  const openSheet = () => {
    setContext(snapshot()); // as things stand the moment they asked for help
    setOpen(true);
  };

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await submit({ message, page: pathname, ...(context ? { context } : {}) });
      setState("sent");
      setMessage("");
      setTimeout(() => { setOpen(false); setState("idle"); }, 1600);
    } catch (err) {
      setError(parseBillingError(err)?.message ?? "That didn't send. Try again in a moment.");
      setState("idle");
    }
  };

  return (
    <>
      <button type="button" className={styles.fab} onClick={openSheet}>
        Something wrong?
      </button>
      {open && (
        <div className={styles.scrim} role="presentation" onClick={() => setOpen(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="fb-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="fb-title" className={styles.title}>Tell us what happened</h2>
            <p className={styles.sub}>
              Anything: a video that looks wrong, a post that didn&apos;t go out, a word that reads badly.
              It reaches us straight away, with the screen you&apos;re on.
            </p>
            {state === "sent" ? (
              <p className={styles.note}>Got it — thank you. We read every one.</p>
            ) : (
              <>
                <textarea
                  className={styles.box}
                  value={message}
                  autoFocus
                  placeholder="The Telugu video had no sound…"
                  onChange={(e) => setMessage(e.target.value)}
                />
                {context && (
                  <div className={styles.attached}>
                    <p className={styles.attachedTitle}>Sent with your report</p>
                    <ul className={styles.attachedList}>
                      <li>This screen ({pathname})</li>
                      {context.item && <li>The pick on screen{context.item.label ? `: “${context.item.label}”` : ""}</li>}
                      {context.lastError && <li>The last error you saw: “{context.lastError.message}”</li>}
                      <li>
                        Your device: {deviceLabel(context.device.userAgent)}, {context.device.viewport}
                      </li>
                    </ul>
                  </div>
                )}
                {error && <p className={styles.err}>{error}</p>}
                <div className={styles.row}>
                  <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>Cancel</button>
                  <button type="button" className={styles.send} disabled={message.trim().length < 3 || state === "sending"} onClick={() => void send()}>
                    {state === "sending" ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
