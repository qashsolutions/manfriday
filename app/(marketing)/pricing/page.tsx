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
  VIDEO_RULES,
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
              <strong>{FREE.videosTotal}</strong> videos, once — they don&apos;t refill
            </li>
            <li>Unlimited previews in Picks</li>
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
                <strong>{t.videos}</strong> videos every month, any format
              </li>
              <li>Unlimited previews in Picks</li>
              <li>
                Top-ups: <strong>+{TOPUP.videos}</strong> videos for ${TOPUP.price}
              </li>
            </ul>
            <p className={styles.termNote}>
              Same {t.videos} videos a month whichever way you pay.
            </p>
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

      <section className={`panel ${styles.included}`} aria-labelledby="what-counts">
        <h2 id="what-counts" className={`mono ${styles.includedTitle}`}>WHAT COUNTS AS A VIDEO</h2>
        <p className={styles.countsLead}>
          Every time you give Friday your product&apos;s URL, it drafts{" "}
          <strong>{VIDEO_RULES.picksPerBatch} picks</strong> as free previews. You only use a video
          when you keep one.
        </p>
        <div className={styles.counts}>
          <div>
            <h3 className={`mono ${styles.countsHead}`}>USES 1 VIDEO</h3>
            <ul className={styles.countsList} data-kind="uses">
              {VIDEO_RULES.counts.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className={`mono ${styles.countsHead}`}>FREE</h3>
            <ul className={styles.countsList} data-kind="free">
              {VIDEO_RULES.free.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className={styles.fine}>
          Example: on {TIERS[0].name} you keep {TIERS[0].videos - 4} picks in English and add 2 of
          them in Spanish and 2 in Hindi — that&apos;s {TIERS[0].videos} videos, your whole month.{" "}
          {VIDEO_RULES.note}
        </p>
      </section>

      <section className={`panel ${styles.included}`}>
        <h2 className={`mono ${styles.includedTitle}`}>EVERY PLAN INCLUDES</h2>
        <ul className={styles.features}>
          {SHARED_FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className={styles.langs}>{LANGUAGES.map((l) => l.name).join(" · ")}</p>
        <p className={styles.fine}>
          <strong>Start free, no card</strong> — a card only appears when you subscribe. Paid
          plans refill every month on the day you subscribed, whether you pay monthly, quarterly,
          annually or for 3 years; unused videos don&apos;t roll over. Need more, add{" "}
          <strong>+{TOPUP.videos} videos for ${TOPUP.price}</strong> on any paid plan — top-ups are
          used after your monthly videos and don&apos;t expire while your plan is active. One
          product per account. Slideshows post to TikTok only. The 3-year {FOUNDING.label} plan is
          pay-today, no cancellation, first {FOUNDING.cap} customers only. Pause any paid plan
          for up to {POLICY.pauseMaxDays} days, once every 30 days — Friday holds your posts and
          the paused days are added to your term.
        </p>
      </section>
    </div>
  );
}
