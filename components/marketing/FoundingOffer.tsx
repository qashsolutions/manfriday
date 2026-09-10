import Link from "next/link";
import { TIERS, FOUNDING, SHARED_FEATURES } from "@/lib/site";
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
            pay today · no cancellation · first {FOUNDING.cap} customers only — or start
            free with no card, from ${solo.monthly}/mo when you&apos;re ready
          </p>
        </article>
      </div>
    </section>
  );
}
