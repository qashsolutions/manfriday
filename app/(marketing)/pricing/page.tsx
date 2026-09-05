import type { Metadata } from "next";
import Link from "next/link";
import { PRICING, PLAN_FEATURES } from "@/lib/site";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description: `One plan, every feature. $${PRICING.monthly}/mo — or ${"$" + PRICING.threeYear} once for 3 full years while the Founding ${PRICING.foundingCap.toLocaleString()} lasts.`,
};

const TERMS = [
  {
    name: "Monthly",
    price: PRICING.monthly,
    unit: "/month",
    perMonth: PRICING.monthly,
    note: `$0 for the first ${PRICING.trialDays} days · cancel anytime`,
    cta: "Start free",
    flagship: false,
  },
  {
    name: "Quarterly",
    price: PRICING.quarterly,
    unit: "/quarter",
    perMonth: PRICING.quarterly / 3,
    note: "billed every 3 months",
    cta: "Hire Friday",
    flagship: false,
  },
  {
    name: "Annual",
    price: PRICING.annual,
    unit: "/year",
    perMonth: PRICING.annual / 12,
    note: "billed yearly",
    cta: "Hire Friday",
    flagship: false,
  },
  {
    name: "3 Years",
    price: PRICING.threeYear,
    unit: " once",
    perMonth: PRICING.threeYear / 36,
    note: `reg. $${PRICING.threeYearList} — Founding ${PRICING.foundingCap.toLocaleString()} only`,
    cta: "Claim a founding spot →",
    flagship: true,
  },
] as const;

export default function PricingPage() {
  return (
    <div className="wrap">
      <header className={styles.head}>
        <p className="eyebrow">Pricing</p>
        <h1 className={`display ${styles.title}`}>One plan. Pick your term.</h1>
        <p className={styles.sub}>
          Every term gets everything — all three formats, both platforms, every language.
          The only question is how long you&apos;re hiring Friday for.
        </p>
      </header>

      <div className={styles.grid}>
        {TERMS.map((t) => (
          <article key={t.name} className={`${styles.card} ${t.flagship ? styles.flagship : ""}`}>
            {t.flagship && (
              <span className={`mono ${styles.badge}`}>
                FOUNDING {PRICING.foundingCap.toLocaleString()} · [NNN] LEFT
              </span>
            )}
            <h2 className={`mono ${styles.term}`}>{t.name.toUpperCase()}</h2>
            <p className={styles.priceRow}>
              <span className={`display ${styles.price}`}>${t.price}</span>
              <span className={styles.unit}>{t.unit}</span>
            </p>
            <p className={`mono ${styles.perMonth}`}>
              ≈ ${t.perMonth % 1 === 0 ? t.perMonth : t.perMonth.toFixed(2)}/mo
            </p>
            <p className={styles.note}>{t.note}</p>
            <Link
              href="/signup"
              className={`btn ${t.flagship ? "btn--accent" : "btn--ghost"}`}
              style={{ width: "100%", fontSize: 15 }}
            >
              {t.cta}
            </Link>
          </article>
        ))}
      </div>

      <section className={`panel ${styles.included}`}>
        <h2 className={`mono ${styles.includedTitle}`}>EVERY TERM INCLUDES</h2>
        <ul className={styles.features}>
          {PLAN_FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className={styles.fine}>
          Card required at signup. The {PRICING.trialDays}-day free window applies to monthly;
          prepaid terms start the day you pay. Rendering runs on monthly media credits — heavy
          creators can top up anytime.
        </p>
      </section>
    </div>
  );
}
