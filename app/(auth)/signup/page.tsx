import type { Metadata } from "next";
import Link from "next/link";
import { PRICING } from "@/lib/site";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Hire Friday",
  description: `Create your Man Friday account. Founding ${PRICING.foundingCap.toLocaleString()}: 3 years for $${PRICING.threeYear}, or $0 for ${PRICING.trialDays} days then $${PRICING.monthly}/mo.`,
};

const PITCH = [
  {
    title: "Every format that wins",
    body: "Slideshows, faceless hooks, and a presenter who says it to camera — the same one every time, so your account gets a face.",
  },
  {
    title: "Modeled on receipts",
    body: "Every option is built from a trend that already worked — the proof sits right next to it.",
  },
  {
    title: "Posts while you ship",
    body: "Scheduled natively to TikTok and Shorts, in your market's language. Friday picks the times; you approve with a swipe.",
  },
  {
    title: "Counts what pays",
    body: "Every post carries a tracked link — you see clicks to your product, not vanity views.",
  },
] as const;

export default function SignupPage() {
  return (
    <div className={styles.grid}>
      <section className={styles.pitch}>
        <p className="eyebrow">Hire Friday</p>
        <h1 className={`display ${styles.title}`}>Friday starts today.</h1>
        <p className={styles.sub}>
          Create the account, put a card on file, hand over the posting. Friday learns your
          product next.
        </p>
        <div className={styles.points}>
          {PITCH.map((p) => (
            <div key={p.title} className={styles.point}>
              <h2 className={styles.pointTitle}>{p.title}</h2>
              <p className={styles.pointBody}>{p.body}</p>
            </div>
          ))}
        </div>
        <p className={`mono ${styles.founding}`}>
          <span className={styles.dot} />
          FOUNDING {PRICING.foundingCap.toLocaleString()} · 3 YEARS FOR ${PRICING.threeYear} · [NNN] SPOTS LEFT
        </p>
      </section>

      <section className={styles.authCol}>
        <div className={`panel ${styles.card}`}>
          <div>
            <h2 className={styles.cardTitle}>Create your account</h2>
            <p className={styles.cardSub}>
              ${PRICING.threeYear} once for 3 years · or $0 for {PRICING.trialDays} days, then $
              {PRICING.monthly}/mo
            </p>
          </div>
          {/* Clerk mounts here in M2; until then this is the private-beta waitlist state */}
          <div className={styles.betaNote}>
            <span className={`mono ${styles.betaLabel}`}>PRIVATE BETA</span>
            <p>
              Friday is onboarding the Founding {PRICING.foundingCap.toLocaleString()} in small
              batches. Accounts open here shortly — the pricing above is locked for the
              founding cohort.
            </p>
          </div>
          <div className={`mono ${styles.steps}`}>
            <span className={styles.stepDone}>1 ACCOUNT</span>
            <span>→</span>
            <span>2 CARD ON FILE</span>
            <span>→</span>
            <span>3 FRIDAY&apos;S BRIEF</span>
          </div>
          <p className={styles.cardFine}>
            Card required. Monthly starts with {PRICING.trialDays} free days; prepaid terms
            start the day you pay. Cancel monthly anytime.
          </p>
        </div>
        <p className={`mono ${styles.security}`}>
          Secured by Clerk · two-factor authentication available in Settings → Security
        </p>
        <p className={styles.signin}>
          Already hired Friday? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
