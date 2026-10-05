import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { AuthVisual } from "@/components/marketing/AuthVisual";
import { FoundingSpots } from "@/components/marketing/FoundingSpots";
import { FREE, FOUNDING, LANGUAGES, TIERS } from "@/lib/site";
import { safeRedirectPath } from "@/lib/safe-redirect";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  description: `Sign in to Man Friday — short-form video for your product, posted while you build. Start free: ${FREE.videosTotal} videos, no card.`,
};

/** Facts we can actually stand behind: the curated library, not borrowed logos. */
const PROOF = [
  ["252", "breakout posts studied"],
  ["134", "templates built from them"],
  [String(LANGUAGES.length), "languages"],
  ["10", "hook patterns"],
] as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [solo] = TIERS;
  // Came here from a protected page? Go back to it, not to the default.
  const wanted = safeRedirectPath((await searchParams).redirect_url);
  return (
    <div className={styles.grid}>
      <section className={styles.pitch}>
        <p className="eyebrow">You build. Friday posts.</p>
        <h1 className={`display ${styles.title}`}>One paste. A month of video.</h1>

        <div className={styles.visual}>
          <AuthVisual />
        </div>

        <ul className={styles.proof}>
          {PROOF.map(([n, label]) => (
            <li key={label}>
              <span className={`display ${styles.proofNum}`}>{n}</span>
              <span className={styles.proofLabel}>{label}</span>
            </li>
          ))}
        </ul>

        <p className={`mono ${styles.founding}`}>
          <span className={styles.dot} />
          {FOUNDING.label.toUpperCase()} · 3 YEARS FROM ${solo.threeYear}{" "}
          <FoundingSpots separator />
        </p>
      </section>

      <section className={styles.authCol}>
        <SignIn routing="hash" signUpUrl="/signup" fallbackRedirectUrl="/picks" {...(wanted ? { forceRedirectUrl: wanted } : {})} />
        <p className={styles.signin}>
          New here? <Link href="/signup">Hire Friday</Link> — free, no card, {FREE.videosTotal} videos on us.
        </p>
      </section>
    </div>
  );
}
