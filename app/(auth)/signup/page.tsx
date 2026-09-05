import type { Metadata } from "next";
import Link from "next/link";
import { TIERS, TRIAL, FOUNDING } from "@/lib/site";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Hire Friday",
  description: `Create your Man Friday account. Free for ${TRIAL.days} days — no card on day one. ${FOUNDING.label}: 3 years from $${TIERS[0].threeYear}.`,
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
  const [solo] = TIERS;
  return (
    <div className={styles.grid}>
      <section className={styles.pitch}>
        <p className="eyebrow">Hire Friday</p>
        <h1 className={`display ${styles.title}`}>Friday starts today.</h1>
        <p className={styles.sub}>
          Create the account free, hand over the posting. Friday learns your product next — a
          card only joins on day {TRIAL.cardByDay}.
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
          {FOUNDING.label.toUpperCase()} · 3 YEARS FROM ${solo.threeYear} · [NN] OF {FOUNDING.cap} SPOTS LEFT
        </p>
      </section>

      <section className={styles.authCol}>
        <div className={`panel ${styles.card}`}>
          <div>
            <h2 className={styles.cardTitle}>Create your account</h2>
            <p className={styles.cardSub}>
              Free for {TRIAL.days} days — no card on day one · then from ${solo.monthly}/mo
            </p>
          </div>
          {/* Clerk mounts here in M2 (passkey · Google · email, MFA) */}
          <div className={styles.betaNote}>
            <span className={`mono ${styles.betaLabel}`}>PRIVATE BETA</span>
            <p>
              Friday is onboarding the {FOUNDING.label} in small batches. Accounts open here
              shortly — founding pricing is locked for the first {FOUNDING.cap}.
            </p>
          </div>
          <div className={`mono ${styles.steps}`}>
            <span className={styles.stepDone}>1 ACCOUNT</span>
            <span>→</span>
            <span>2 CARD · DAY {TRIAL.cardByDay}</span>
            <span>→</span>
            <span>3 FRIDAY&apos;S BRIEF</span>
          </div>
          <p className={styles.cardFine}>
            No card needed today — add one on day {TRIAL.cardByDay} to keep the trial running.
            3-year founding plans are pay-today, no cancellation.
          </p>
        </div>
        <p className={`mono ${styles.security}`}>
          Secured by Clerk · passkeys supported · two-factor authentication in Settings → Security
        </p>
        <p className={styles.signin}>
          Already hired Friday? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
