import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { PipelineFlow } from "@/components/blog/illustrations";
import { FoundingSpots } from "@/components/marketing/FoundingSpots";
import { FREE, FOUNDING, LANGUAGES, TIERS } from "@/lib/site";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  description: `Sign in to Man Friday — short-form video for your product, posted while you build. Start free: ${FREE.videosTotal} videos, no card.`,
};

const POINTS = [
  {
    title: "You approve, Friday posts",
    body: "Paste your product's URL. Friday writes ten short videos for it and posts the ones you keep to TikTok and YouTube Shorts.",
  },
  {
    title: "Modeled on what already worked",
    body: "Every draft is shaped by a real post that broke out in your niche — the reference sits beside it.",
  },
  {
    title: "Clicks, not vanity views",
    body: "Every post carries a tracked link, so you see which one actually sent people to your product.",
  },
] as const;

export default function LoginPage() {
  const [solo] = TIERS;
  return (
    <div className={styles.grid}>
      <section className={styles.pitch}>
        <p className="eyebrow">You build. Friday posts.</p>
        <h1 className={`display ${styles.title}`}>Short-form video for your product, without filming.</h1>
        <p className={styles.sub}>
          A camera-free content engine for solo builders. {LANGUAGES.length} languages, three formats,
          and one number that matters: clicks to your product.
        </p>

        <figure className={styles.visual}>
          <PipelineFlow />
          <figcaption className={`mono ${styles.visualCaption}`}>
            YOUR URL → FRIDAY&apos;S BRIEF → TEN PICKS → YOUR SWIPE → POSTED
          </figcaption>
        </figure>

        <div className={styles.points}>
          {POINTS.map((p) => (
            <div key={p.title} className={styles.point}>
              <h2 className={styles.pointTitle}>{p.title}</h2>
              <p className={styles.pointBody}>{p.body}</p>
            </div>
          ))}
        </div>

        <p className={`mono ${styles.founding}`}>
          <span className={styles.dot} />
          {FOUNDING.label.toUpperCase()} · 3 YEARS FROM ${solo.threeYear}{" "}
          <FoundingSpots separator />
        </p>
      </section>

      <section className={styles.authCol}>
        <SignIn routing="hash" signUpUrl="/signup" fallbackRedirectUrl="/picks" />
        <p className={styles.signin}>
          New here? <Link href="/signup">Hire Friday</Link> — free, no card, {FREE.videosTotal} videos on us.
        </p>
      </section>
    </div>
  );
}
