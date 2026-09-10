import styles from "./PicksDemo.module.css";

/* One real pairing from the sample brand (Loopnote, fictional): the trend the
   concept is modeled on, and Friday's concept for the product. Static in v2.0;
   v2.1 cycles the right card (see docs/landing-v2.md). */
export function PicksDemo() {
  return (
    <section className={styles.section} aria-label="A live example from the Picks feed">
      <div className={`mono ${styles.liveChip}`}>
        <span className={styles.liveDot} aria-hidden="true" />
        LIVE PICKS · WHAT FRIDAY MADE FOR LOOPNOTE THIS MORNING
      </div>

      <div className={styles.pair}>
        <div className={styles.col}>
          <p className={`mono ${styles.colLabel}`}>TREND REFERENCE · 2.9M VIEWS</p>
          <article className={`${styles.card} ${styles.reference}`}>
            <div className={styles.cardTop}>
              <span className={`mono ${styles.cardMeta}`}>@somebody · slideshow</span>
              <span className={styles.play} aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </div>
            <div className={styles.cardBottom}>
              <h3 className={`${styles.hook} ${styles.hookDim}`}>my side project made $0 for a year. then one change</h3>
              <p className={`mono ${styles.cardMeta}`}>6 SLIDES · 2.9M VIEWS · 41K SAVES</p>
            </div>
          </article>
        </div>

        <div className={styles.relation} aria-hidden="true">
          <svg width="56" height="24" viewBox="0 0 56 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h50" />
            <path d="m44 4 8 8-8 8" />
          </svg>
          <span className={`mono ${styles.relationLabel}`}>
            SAME FORMAT
            <br />
            YOUR PRODUCT
          </span>
        </div>

        <div className={styles.col}>
          <p className={`mono ${styles.colLabel} ${styles.colLabelAccent}`}>FRIDAY&apos;S PICK · READY TO POST</p>
          <article className={`${styles.card} ${styles.pick}`}>
            <div className={styles.cardTop}>
              <span className={`mono ${styles.cardMetaAccent}`}>SLIDE 1 / 6</span>
              <span className={`mono ${styles.cardMetaAccent}`}>EN · 0:14</span>
            </div>
            <div className={styles.cardBottom}>
              <h3 className={styles.hook}>Loopnote made $0 for 6 months. then I changed one thing</h3>
              <p className={`mono ${styles.cardMetaAccent}`}>SLIDESHOW · 6 SLIDES · MADE FOR LOOPNOTE</p>
            </div>
          </article>
        </div>
      </div>

      <div className={`mono ${styles.legend}`}>
        <span className={styles.skip}>← SKIP</span>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.count}>3 OF 10 TODAY</span>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.keep}>KEEP — FRIDAY POSTS IT →</span>
      </div>
    </section>
  );
}
