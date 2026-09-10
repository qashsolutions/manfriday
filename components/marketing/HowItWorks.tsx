import styles from "./HowItWorks.module.css";

/* Each step shows the product instead of describing it (docs/landing-v2.md §5). */
export function HowItWorks() {
  return (
    <section className={styles.section}>
      <div className="wrap">
        <div className={styles.head}>
          <p className="eyebrow eyebrow--dim">How it works</p>
          <h2 className={`display ${styles.title}`}>What Friday does while you ship</h2>
        </div>
        <div className={styles.grid}>
          <article className={`panel ${styles.card}`}>
            <div className={styles.visual} aria-hidden="true">
              <p className={`mono ${styles.briefLabel}`}>FRIDAY&apos;S BRIEF ON LOOPNOTE</p>
              <div className={styles.briefRow}><span className="mono">PRODUCT</span><span>Voice notes that turn into to-dos</span></div>
              <div className={styles.briefRow}><span className="mono">AUDIENCE</span><span>Indie founders drowning in ideas</span></div>
              <div className={styles.briefRow}><span className="mono">TONE</span><span>Plain, a little dry, no hype</span></div>
              <div className={styles.briefRow}>
                <span className="mono">LANGUAGE</span>
                <span className={styles.langChip}>
                  English <span className={`mono ${styles.langPick}`}>FRIDAY&apos;S PICK</span>
                </span>
              </div>
            </div>
            <h3 className={styles.cardTitle}>Friday learns your product</h3>
            <p className={styles.cardBody}>
              Paste your URL. Friday writes a brand brief you approve once; every video after is
              grounded in it.
            </p>
          </article>

          <article className={`panel ${styles.card}`}>
            <div className={`${styles.visual} ${styles.visualSwipe}`} aria-hidden="true">
              <div className={styles.miniBack} />
              <div className={styles.miniFront}>
                <span>$0 for 6 months…</span>
              </div>
              <div className={`mono ${styles.swipeHints}`}>
                <span className={styles.keep}>→ KEEP</span>
                <span>← SKIP</span>
              </div>
            </div>
            <h3 className={styles.cardTitle}>You swipe. That&apos;s the job.</h3>
            <p className={styles.cardBody}>
              Every concept sits next to the trending video it&apos;s modeled on. Left to skip,
              right to keep. Thirty seconds a day.
            </p>
          </article>

          <article className={`panel ${styles.card}`}>
            <div className={`${styles.visual} ${styles.visualQueue}`} aria-hidden="true">
              <div className={styles.queueRow}><span>Tue · 17:30</span><span className={`mono ${styles.chipLive}`}>TIKTOK · LIVE</span></div>
              <div className={styles.queueRow}><span>Wed · 17:30</span><span className={`mono ${styles.chipQueued}`}>SHORTS · QUEUED</span></div>
              <div className={styles.queueRow}><span>Thu · 17:30</span><span className={`mono ${styles.chipQueued}`}>TIKTOK · QUEUED</span></div>
            </div>
            <h3 className={styles.cardTitle}>Friday posts, and learns</h3>
            <p className={styles.cardBody}>
              Captions written, best time picked, live on TikTok and Shorts. Friday watches which
              posts send people to your product and makes more of those.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
