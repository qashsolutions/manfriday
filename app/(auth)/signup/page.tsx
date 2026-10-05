import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignUp, Waitlist } from "@clerk/nextjs";
import { RememberUrl } from "@/components/marketing/RememberUrl";
import { FoundingSpots } from "@/components/marketing/FoundingSpots";
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

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [solo] = TIERS;
  // An invited tester arrives with a ticket. Only <SignUp/> can redeem it; the
  // public still meets the waitlist, so this does not open registration. Who may
  // actually register is Clerk's instance setting, not which component renders.
  const raw = (await searchParams).__clerk_ticket;
  const invited = typeof raw === "string" && raw.length > 0;
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
          {FOUNDING.label.toUpperCase()} · 3 YEARS FROM ${solo.threeYear} <FoundingSpots separator />
        </p>
      </section>

      <section className={styles.authCol}>
        <div className={`panel ${styles.card}`}>
          <div>
            <h2 className={styles.cardTitle}>
              {invited ? "You\u2019re invited" : "Create your account"}
            </h2>
            <p className={styles.cardSub}>
              {invited
                ? `Finish your account and Friday gets to work \u00b7 no card`
                : `Start free \u00b7 ${FREE.videosTotal} videos on us \u00b7 from $${solo.monthly}/mo when ready`}
            </p>
          </div>
          {invited ? (
            <SignUp routing="hash" signInUrl="/login" fallbackRedirectUrl="/onboarding" />
          ) : (
            <Waitlist />
          )}
          <p className={styles.cardFine}>
            {invited
              ? "Your beta place is held for this address. Pick any sign-in method \u2014 passkey, Google, GitHub, or a password."
              : `Friday is onboarding the ${FOUNDING.label} in small batches \u2014 join the list and founding pricing is locked for the first ${FOUNDING.cap}.`}
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
