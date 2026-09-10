import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Waitlist } from "@clerk/nextjs";
import { RememberUrl } from "@/components/marketing/RememberUrl";
import { TIERS, FREE, FOUNDING } from "@/lib/site";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Hire Friday",
  description: `Create your Man Friday account free — no card, ${FREE.videosTotal} videos on us. ${FOUNDING.label}: 3 years from $${TIERS[0].threeYear}.`,
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
      <Suspense fallback={null}>
        <RememberUrl />
      </Suspense>
      <section className={styles.pitch}>
        <p className="eyebrow">Hire Friday</p>
        <h1 className={`display ${styles.title}`}>Friday starts today.</h1>
        <p className={styles.sub}>
          Create the account free — no card. Friday learns your product, makes your first{" "}
          {FREE.videosTotal} videos on the house, and you upgrade only when you want volume.
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
              Start free · {FREE.videosTotal} videos on us · from ${solo.monthly}/mo when ready
            </p>
          </div>
          {/* Waitlist mode until the beta opens; swap <Waitlist/> → <SignUp/> then. */}
          <Waitlist />
          <p className={styles.cardFine}>
            Friday is onboarding the {FOUNDING.label} in small batches — join the list and
            founding pricing is locked for the first {FOUNDING.cap}.
          </p>
          <div className={`mono ${styles.steps}`}>
            <span className={styles.stepDone}>1 ACCOUNT</span>
            <span>→</span>
            <span>2 FRIDAY&apos;S BRIEF</span>
            <span>→</span>
            <span>3 FIRST VIDEOS FREE</span>
          </div>
          <p className={styles.cardFine}>
            No card until you subscribe. 3-year founding plans are pay-today, no
            cancellation — first {FOUNDING.cap} customers only.
          </p>
        </div>
        <p className={`mono ${styles.security}`}>
          Secured by Clerk · passkeys · Google · GitHub · any email · 2FA in Settings → Security
        </p>
        <p className={styles.signin}>
          Already hired Friday? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
