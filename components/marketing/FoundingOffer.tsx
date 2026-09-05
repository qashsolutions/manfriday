import Link from "next/link";
import { TIERS, TRIAL, FOUNDING, SHARED_FEATURES } from "@/lib/site";
import styles from "./FoundingOffer.module.css";

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function FoundingOffer() {
  const [solo, studio] = TIERS;
  return (
    <section className={styles.section} id="founding">
      <div className={`wrap ${styles.inner}`}>
        <article className={styles.offer}>
          <div className={styles.offerHead}>
            <span className={`mono ${styles.label}`}>{FOUNDING.label.toUpperCase()}</span>
            <span className={`mono ${styles.spots}`}>[NN] of {FOUNDING.cap} spots left</span>
          </div>
          <div className={styles.priceRow}>
            <span className={`display ${styles.price}`}>${solo.threeYear}</span>
            <span className={styles.priceNote}>
              once — <strong>3 full years</strong> of Friday · Studio tier ${studio.threeYear}
            </span>
          </div>
          <ul className={styles.features}>
            {SHARED_FEATURES.map((f) => (
              <li key={f}>
                <Check />
                {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className="btn btn--accent" style={{ width: "100%" }}>
            Claim a founding spot →
          </Link>
          <p className={`mono ${styles.fine}`}>
            pay today · no cancellation · first {FOUNDING.cap} customers only — or start free for{" "}
            {TRIAL.days} days, then from ${solo.monthly}/mo
          </p>
        </article>

        <aside className={`panel ${styles.call}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.78.65 2.63a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.45-1.22a2 2 0 0 1 2.11-.45c.85.31 1.73.53 2.63.65A2 2 0 0 1 22 16.92z" />
          </svg>
          <h3 className={styles.callTitle}>Book a call with Friday&apos;s makers, get +7 days free</h3>
          <p className={styles.callBody}>
            20 minutes. You show us how you work, we make Friday better at the job. The extra
            week is on us.
          </p>
          <Link href="/signup" className="btn btn--ghost" style={{ fontSize: 14.5, padding: "11px 0", width: "100%" }}>
            Book a call
          </Link>
        </aside>
      </div>
    </section>
  );
}
