import type { Metadata } from "next";
import Link from "next/link";
import { TIERS, TRIAL, FOUNDING, SHARED_FEATURES, LANGUAGES } from "@/lib/site";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Solo from $${TIERS[0].monthly}/mo, Studio from $${TIERS[1].monthly}/mo — free for ${TRIAL.days} days, no card on day one. ${FOUNDING.label}: 3 years from $${TIERS[0].threeYear}.`,
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
        <h1 className={`display ${styles.title}`}>Two ways to hire Friday.</h1>
        <p className={styles.sub}>
          Same product on both — every format, both platforms, all {LANGUAGES.length}{" "}
          languages. The tiers differ only in how much Friday makes for you each month.
        </p>
      </header>

      <div className={styles.grid}>
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
                <strong>{t.saves}</strong> content saves / month
              </li>
              <li>
                <strong>{t.credits}</strong> AI studio credits / month
              </li>
              <li>
                <strong>{t.workspaces}</strong> workspaces
              </li>
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
              Start {t.name} free →
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
        <p className={styles.langs}>
          {LANGUAGES.map((l) => l.name).join(" · ")}
        </p>
        <p className={styles.fine}>
          Every plan starts with <strong>{TRIAL.days} free days — no card on day one</strong>;
          add a card on day {TRIAL.cardByDay} to keep the trial running. The 3-year{" "}
          {FOUNDING.label} plan is pay-today, no cancellation, first {FOUNDING.cap} customers
          only. Need more volume? Credit top-ups are available on any plan. Pause any plan for
          up to {TRIAL.pauseMaxDays} days — paused days are added to your term.
        </p>
      </section>
    </div>
  );
}
