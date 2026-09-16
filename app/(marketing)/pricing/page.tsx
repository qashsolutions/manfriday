import type { Metadata } from "next";
import Link from "next/link";
import {
  TIERS,
  FREE,
  TOPUP,
  POLICY,
  FOUNDING,
  SHARED_FEATURES,
  LANGUAGES,
} from "@/lib/site";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Start free — no card. Solo $${TIERS[0].monthly}/mo for ${TIERS[0].videos} videos, Studio $${TIERS[1].monthly}/mo for ${TIERS[1].videos}. ${FOUNDING.label}: 3 years for $${TIERS[0].threeYear}.`,
};

function perMonth(n: number, months: number) {
  const v = n / months;
  return v % 1 === 0 ? `$${v}` : `$${v.toFixed(2)}`;
}

export default function PricingPage() {
  return (
    <div className="wrap">
      <header className={styles.head}>
        <p className="eyebrow">Pricing</p>
        <h1 className={`display ${styles.title}`}>Videos per month. That&apos;s the whole unit.</h1>
        <p className={styles.sub}>
          Every plan gets every feature — all formats, both platforms, all {LANGUAGES.length}{" "}
          languages. You&apos;re only choosing how many videos Friday makes for you.
        </p>
      </header>

      <div className={styles.grid}>
        {/* Free */}
        <article className={styles.card}>
          <h2 className={`display ${styles.tierName}`}>{FREE.name}</h2>
          <p className={styles.priceRow}>
            <span className={`display ${styles.price}`}>$0</span>
          </p>
          <ul className={styles.entitlements}>
            <li>
              <strong>{FREE.videosTotal}</strong> videos to try — one-time
            </li>
            <li>Browse the full Picks feed</li>
            <li>
              <strong>{FREE.workspaces}</strong> workspace
            </li>
            <li>No card required</li>
          </ul>
          <div className={styles.spacer} />
          <Link href="/signup" className="btn btn--ghost" style={{ width: "100%", fontSize: 15 }}>
            Start free →
          </Link>
        </article>

        {TIERS.map((t) => (
          <article key={t.id} className={`${styles.card} ${t.highlight ? styles.flagship : ""}`}>
            {t.highlight && <span className={`mono ${styles.badge}`}>MOST FRIDAY</span>}
            <h2 className={`display ${styles.tierName}`}>{t.name}</h2>
            <p className={styles.priceRow}>
              <span className={`display ${styles.price}`}>${t.monthly}</span>
              <span className={styles.unit}>/month</span>
            </p>
            <ul className={styles.entitlements}>
              <li>
                <strong>{t.videos}</strong> videos / month, any format
              </li>
              <li>
                <strong>{t.workspaces}</strong> workspaces
              </li>
              <li>Publishes on schedule, hands-free</li>
            </ul>
            <div className={styles.terms}>
              <div className={styles.termRow}>
                <span>Quarterly</span>
                <span className={`mono ${styles.termMath}`}>{perMonth(t.quarterly, 3)}/mo</span>
                <span className={styles.termPrice}>${t.quarterly}</span>
              </div>
              <div className={styles.termRow}>
                <span>Annual</span>
                <span className={`mono ${styles.termMath}`}>{perMonth(t.annual, 12)}/mo</span>
                <span className={styles.termPrice}>${t.annual}</span>
              </div>
              <div className={`${styles.termRow} ${styles.termFounding}`}>
                <span>
                  3 years <span className={`mono ${styles.foundingTag}`}>{FOUNDING.label.toUpperCase()}</span>
                </span>
                <span className={`mono ${styles.termMath}`}>{perMonth(t.threeYear, 36)}/mo</span>
                <span className={styles.termPrice}>${t.threeYear} once</span>
              </div>
            </div>
            <Link
              href="/signup"
              className={`btn ${t.highlight ? "btn--accent" : "btn--ghost"}`}
              style={{ width: "100%", fontSize: 15 }}
            >
              Start {t.name} →
            </Link>
          </article>
        ))}
      </div>

      <section className={`panel ${styles.included}`}>
        <h2 className={`mono ${styles.includedTitle}`}>EVERY PLAN INCLUDES</h2>
        <ul className={styles.features}>
          {SHARED_FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className={styles.langs}>{LANGUAGES.map((l) => l.name).join(" · ")}</p>
        <p className={styles.fine}>
          <strong>Start free, no card</strong> — a card only appears when you subscribe. Video
          allowances reset monthly and don&apos;t roll over; need more, add{" "}
          <strong>+{TOPUP.videos} videos for ${TOPUP.price}</strong> anytime. The 3-year{" "}
          {FOUNDING.label} plan is pay-today, no cancellation, first {FOUNDING.cap} customers
          only. Pause any paid plan for up to {POLICY.pauseMaxDays} days — paused days are
          added to your term.
        </p>
      </section>
    </div>
  );
}
