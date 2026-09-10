import styles from "./Attribution.module.css";

/* Sample numbers are illustrative and constant (docs/landing-v2.md). */
const WEEK = [
  { clicks: 41, hook: "“$0 for 6 months”", width: 100 },
  { clicks: 31, hook: "“replaced my $2k editor”", width: 75 },
  { clicks: 23, hook: "“3 weeks of this”", width: 55 },
  { clicks: 12, hook: "“stop posting”", width: 30 },
  { clicks: 6, hook: "“POV: 1,000 users”", width: 14 },
] as const;

export function Attribution() {
  return (
    <section className={styles.section}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.head}>
          <p className={`eyebrow ${styles.eyebrow}`}>The only number that pays rent</p>
          <h2 className={`display ${styles.title}`}>See which post sent people to your product.</h2>
          <p className={styles.sub}>
            Every caption carries a tracked link. Views are vanity; clicks are the signal. Friday
            makes more of whatever sent people your way, and quietly retires what didn&apos;t.
          </p>
        </div>

        <div className={styles.cards}>
          <article className={`panel ${styles.post}`}>
            <div className={styles.thumb} aria-hidden="true">
              <span>Loopnote made $0 for 6 months…</span>
            </div>
            <div className={styles.postBody}>
              <div className={styles.postMeta}>
                <span className={`mono ${styles.liveChip}`}>
                  <span className={styles.liveDot} aria-hidden="true" />
                  LIVE · TIKTOK
                </span>
                <span className={`mono ${styles.when}`}>TUE 17:30 · 3 DAYS AGO</span>
              </div>
              <p className={styles.caption}>
                “Loopnote made $0 for 6 months. Then I changed one thing.” · manfriday.app/l/lp-4k2
              </p>
              <dl className={styles.metrics}>
                <div className={styles.metric}>
                  <dt className="mono">VIEWS</dt>
                  <dd className="display">12.4K</dd>
                </div>
                <div className={styles.metric}>
                  <dt className="mono">WATCHED</dt>
                  <dd className="display">61%</dd>
                </div>
                <div className={`${styles.metric} ${styles.metricClicks}`}>
                  <dt className="mono">CLICKED TO LOOPNOTE</dt>
                  <dd className="display">41</dd>
                </div>
              </dl>
            </div>
          </article>

          <article className={`panel ${styles.week}`}>
            <div className={styles.weekHead}>
              <span className={`mono ${styles.weekLabel}`}>THIS WEEK · BY CLICKS</span>
              <span className={`mono ${styles.weekTotal}`}>113 TOTAL</span>
            </div>
            <ol className={styles.bars}>
              {WEEK.map((w, i) => (
                <li key={w.hook} className={styles.bar}>
                  <span
                    className={styles.fill}
                    style={{ width: `${w.width}%`, opacity: i === 0 ? 1 : Math.max(0.35, 1 - i * 0.18) }}
                    aria-hidden="true"
                  />
                  <span className={`mono ${styles.barLabel} ${i === 0 ? styles.barLabelTop : ""}`}>
                    {w.clicks} · {w.hook}
                  </span>
                </li>
              ))}
            </ol>
            <p className={styles.note}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
              </svg>
              Friday noticed the “$0 → one change” hook wins for you and drafted 3 more like it for
              tomorrow.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
