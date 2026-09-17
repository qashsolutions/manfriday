"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { FOUNDING, FREE, POLICY, TIERS, TOPUP } from "@/lib/site";
import { parseBillingError } from "@/lib/billing-copy";
import { useBilling } from "./useBilling";
import styles from "./SettingsPanel.module.css";

const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const TERM_LABEL = { monthly: "MONTHLY", quarterly: "QUARTERLY", annual: "ANNUAL", threeYear: "FOUNDING" } as const;

/** Settings › Plan & billing. Everything here opens a Stripe-hosted page or
 *  calls a pause mutation; plan state itself only ever changes via webhook. */
export function BillingSection() {
  const { billing, busy, error, checkout, portal } = useBilling();
  const spots = useQuery(api.billing.foundingSpotsLeft);
  const resume = useMutation(api.billing.resumePlan);
  const [pauseDays, setPauseDays] = useState<number>(POLICY.pauseMaxDays);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [returned, setReturned] = useState<"success" | "cancel" | null>(null);
  const { pause } = usePause();

  // Back from Stripe Checkout: the webhook usually lands within seconds.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("checkout");
    if (c === "success" || c === "cancel") setReturned(c);
  }, []);

  if (billing === undefined) return null;
  if (billing === null) return null;

  const paid = billing.standing === "paid";
  const founding = billing.term === "threeYear";
  const tier = TIERS.find((t) => t.id === billing.tier);

  const chip =
    billing.standing === "free"
      ? `FREE · ${billing.remaining} OF ${FREE.videosTotal} LEFT · NO CARD`
      : billing.standing === "lapsed"
        ? "PLAN ENDED"
        : `${tier?.name.toUpperCase()} · ${billing.term ? TERM_LABEL[billing.term] : ""}${billing.foundingNumber ? ` #${billing.foundingNumber}` : ""}`;

  const summary =
    billing.standing === "free"
      ? `Previews are always free. Each video you keep uses one of your ${FREE.videosTotal} free videos.`
      : billing.standing === "lapsed"
        ? "Your plan has ended. Your brand, drafts and schedule are still here. Pick a plan below to keep making videos."
        : [
            `${billing.remaining} of ${billing.limit + billing.topup} videos left this month`,
            billing.topup > 0 ? `${billing.topup} from top-ups` : null,
            billing.resetsAt ? `refills ${date(billing.resetsAt)}` : null,
            founding && billing.accessEndsAt ? `plan runs until ${date(billing.accessEndsAt)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") + ".";

  async function onPause() {
    setPausing(true);
    setPauseError(null);
    const msg = await pause(pauseDays);
    if (msg) setPauseError(msg);
    setPausing(false);
  }

  return (
    <section className={styles.section} aria-labelledby="s-plan">
      <h2 id="s-plan" className={`mono ${styles.sectionTitle}`}>PLAN &amp; BILLING</h2>

      {returned === "success" && (
        <p className={styles.notice} data-tone="ok">
          Payment received. {paid ? "Your plan is active." : "Your plan switches on in a few seconds — this page updates by itself."}
        </p>
      )}
      {returned === "cancel" && <p className={styles.notice}>Checkout closed. Nothing was charged.</p>}
      {billing.paymentFailed && (
        <p className={styles.notice} data-tone="warn">
          Your last payment didn&apos;t go through. Stripe retries automatically — update your card in Manage billing to keep your plan.
        </p>
      )}
      {billing.cancelAt && <p className={styles.notice}>Your plan ends on {date(billing.cancelAt)}. You keep your videos until then.</p>}

      <div className={styles.panel}>
        <div className={styles.row}>
          <div>
            <p className={styles.rowTitle}>
              Current plan <span className={`mono ${styles.trialChip}`}>{chip}</span>
            </p>
            <p className={styles.rowSub}>{summary}</p>
          </div>
          {billing.canManage && (
            <button className={styles.ghostBtn} type="button" disabled={busy !== null} onClick={portal}>
              {busy === "portal" ? "Opening…" : "Manage billing"}
            </button>
          )}
        </div>

        {!paid && (
          <div className={styles.planGridRow}>
            <table className={styles.planTable}>
              <thead>
                <tr>
                  <th></th>
                  {TIERS.map((t) => (
                    <th key={t.id} className={t.highlight ? styles.planHi : undefined}>
                      {t.name} · {t.videos} videos/mo
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Monthly", "monthly", (t: (typeof TIERS)[number]) => `$${t.monthly}/mo`],
                    ["Quarterly", "quarterly", (t: (typeof TIERS)[number]) => `$${t.quarterly}`],
                    ["Annual", "annual", (t: (typeof TIERS)[number]) => `$${t.annual}`],
                  ] as const
                ).map(([label, term, price]) => (
                  <tr key={term}>
                    <td>{label}</td>
                    {TIERS.map((t) => {
                      const key = `${t.id}_${term}`;
                      return (
                        <td key={t.id}>
                          <button type="button" className={styles.priceBtn} disabled={busy !== null} onClick={() => checkout(key)}>
                            {busy === key ? "Opening…" : price(t)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className={styles.planFoundingRow}>
                  <td>
                    3 years <span className={styles.planBadge}>{FOUNDING.label.toUpperCase()}</span>
                  </td>
                  {TIERS.map((t) => {
                    const key = `${t.id}_founding_3y`;
                    const full = spots !== undefined && spots.left === 0;
                    return (
                      <td key={t.id}>
                        <button type="button" className={styles.priceBtn} data-strong="true" disabled={busy !== null || full} onClick={() => checkout(key)}>
                          {busy === key ? "Opening…" : `$${t.threeYear} once`}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            <p className={styles.planFine}>
              {FOUNDING.label}: first {FOUNDING.cap} customers · pay today · no cancellation
              {spots ? ` · ${spots.left === 0 ? "all spots taken" : `${spots.left} of ${spots.cap} spots left`}` : ""}
            </p>
          </div>
        )}

        <div className={styles.row}>
          <div>
            <p className={styles.rowTitle}>Top-up</p>
            <p className={styles.rowSub}>
              +{TOPUP.videos} videos for ${TOPUP.price}, used after your monthly videos and kept while your plan is active.
              {paid ? "" : " Paid plans only."}
            </p>
          </div>
          <button className={styles.ghostBtn} type="button" disabled={!paid || busy !== null} onClick={() => checkout(`topup_${TOPUP.videos}`)}>
            {busy === `topup_${TOPUP.videos}` ? "Opening…" : `Add ${TOPUP.videos} · $${TOPUP.price}`}
          </button>
        </div>

        <div className={styles.row}>
          <div>
            <p className={styles.rowTitle}>Billing</p>
            <p className={styles.rowSub}>
              {billing.canManage
                ? founding
                  ? "Receipts and card, on Stripe."
                  : "Card, invoices, switch plan or billing period, cancel — on Stripe."
                : "Card, invoices and receipts live on Stripe after your first purchase."}
            </p>
          </div>
          <button className={styles.ghostBtn} type="button" disabled={!billing.canManage || busy !== null} onClick={portal}>
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        </div>

        <div className={styles.row}>
          <div>
            <p className={styles.rowTitle}>Pause plan</p>
            <p className={styles.rowSub}>
              {billing.pausedUntil
                ? `Paused until ${new Date(billing.pausedUntil).toLocaleString()}. Friday holds your scheduled posts until then, and the paused days are added to your term.`
                : billing.pauseAvailableAt
                  ? `You can pause again on ${date(billing.pauseAvailableAt)}. One pause every 30 days.`
                  : `Up to ${POLICY.pauseMaxDays} days. Friday holds your scheduled posts, and the paused days are added to your term.${paid ? "" : " Paid plans only."}`}
            </p>
            {pauseError && <p className={styles.rowSub} style={{ color: "var(--accent)" }}>{pauseError}</p>}
          </div>
          {billing.pausedUntil ? (
            <button className={styles.ghostBtn} type="button" onClick={() => void resume({})}>
              Resume now
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <div role="radiogroup" aria-label="Pause length" className={styles.toggleGroup}>
                {Array.from({ length: POLICY.pauseMaxDays }, (_, i) => i + 1).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={pauseDays === d}
                    disabled={!billing.canPause}
                    className={`${styles.toggleBtn} ${pauseDays === d ? styles.toggleOn : ""}`}
                    onClick={() => setPauseDays(d)}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <button className={styles.ghostBtn} type="button" disabled={!billing.canPause || pausing} onClick={() => void onPause()}>
                {pausing ? "Pausing…" : "Pause"}
              </button>
            </div>
          )}
        </div>
      </div>
      {error && <p className={styles.notice} data-tone="warn">{error}</p>}
    </section>
  );
}

function usePause() {
  const pausePlan = useAction(api.billing.pausePlan);
  return {
    /** Returns null on success, or the sentence to show. */
    pause: async (days: number): Promise<string | null> => {
      try {
        await pausePlan({ days });
        return null;
      } catch (err) {
        return parseBillingError(err)?.message ?? "Couldn't pause right now. Try again in a moment.";
      }
    },
  };
}
