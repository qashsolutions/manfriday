import { UrlCta } from "./UrlCta";
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
        Paste your product&apos;s URL. Friday reads it, drafts short videos modeled on what&apos;s
        already winning in your niche, and posts them to TikTok and Shorts. You approve with a
        swipe.
      </p>
      <UrlCta />
    </section>
  );
}
