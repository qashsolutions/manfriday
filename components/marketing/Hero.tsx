import Link from "next/link";
import { FOUNDING, TIERS } from "@/lib/site";
import styles from "./Hero.module.css";

export function Hero() {
  return (
    <section className={styles.hero}>
      <p className="eyebrow">A content sidekick for solo builders</p>
      <h1 className={`display ${styles.title}`}>
        You build.
        <br />
        Friday posts.
      </h1>
      <p className={styles.sub}>
        Paste your product&apos;s URL and Friday takes the job nobody hired for: studying
        what&apos;s trending in your niche, drafting the videos, and posting them to TikTok and
        YouTube Shorts — every day, without being asked. You approve with a swipe.
      </p>
      <div className={styles.ctas}>
        <Link href="/signup" className="btn btn--accent" style={{ fontSize: 17, padding: "16px 34px" }}>
          Hire Friday →
        </Link>
        <Link href="/pricing" className="btn btn--ghost" style={{ fontSize: 17 }}>
          See founding pricing
        </Link>
      </div>
      <p className={`mono ${styles.fine}`}>
        Start free — no card · {FOUNDING.label}: 3 years from ${TIERS[0].threeYear}
      </p>
    </section>
  );
}
