import styles from "./SwipeStrip.module.css";

const CARDS = [
  { text: "3 years in the gym vs 3 weeks of this", meta: "HOOK · 0:07", tone: "violet", side: 2 },
  { text: "POV: your first 1,000 users found you overnight", meta: "AVATAR · 0:12", tone: "plum", side: 1 },
  {
    text: "my app made $0 for 6 months. then I changed one thing",
    meta: "SLIDESHOW · 6 SLIDES · MADE FOR LOOPNOTE",
    tone: "center",
    side: 0,
  },
  { text: "I replaced my $2k editor with a link", meta: "FACELESS · 0:19", tone: "steel", side: 1 },
  { text: "stop posting. start shipping formats that already won", meta: "SLIDESHOW · 5 SLIDES", tone: "moss", side: 2 },
] as const;

export function SwipeStrip() {
  return (
    <section className={styles.strip} aria-label="Examples of concepts in the Picks feed">
      <div className={styles.row}>
        {CARDS.map((c) =>
          c.tone === "center" ? (
            <div key={c.text} className={styles.centerCol}>
              <div className={`mono ${styles.trendChip}`}>
                <span className={styles.liveDot} />
                TREND REF · 2.9M VIEWS · SLIDESHOW
              </div>
              <article className={`${styles.card} ${styles.cardCenter}`}>
                <h3 className={styles.cardTitle}>{c.text}</h3>
                <p className={`mono ${styles.cardMetaAccent}`}>{c.meta}</p>
              </article>
            </div>
          ) : (
            <article
              key={c.text}
              className={`${styles.card} ${styles[c.tone]} ${c.side === 2 ? styles.far : styles.near}`}
            >
              <h3 className={styles.cardTitle}>{c.text}</h3>
              <p className={`mono ${styles.cardMeta}`}>{c.meta}</p>
            </article>
          ),
        )}
      </div>
      <div className={`mono ${styles.legend}`}>
        <span className={styles.skip}>✕&ensp;swipe left to skip</span>
        <span className={styles.keep}>→&ensp;swipe right — Friday handles the rest</span>
      </div>
    </section>
  );
}
