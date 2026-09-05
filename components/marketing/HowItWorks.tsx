import styles from "./HowItWorks.module.css";

const STEPS = [
  {
    title: "Friday learns your product",
    body: "Paste your URL. Friday reads the site and writes a brand brief — product, audience, tone, niche, and the language your market speaks. You approve it once; every video after is grounded in it.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
    ),
  },
  {
    title: "You swipe. That's the job.",
    body: "Every concept sits next to the real trending video it's modeled on — proof before you post. Left to skip, right to keep. Thirty seconds a day, tops.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
      </svg>
    ),
  },
  {
    title: "Friday posts — and learns",
    body: "Captions written, best time picked, live on TikTok and Shorts in minutes. Friday watches which posts send people to your product and quietly makes more of whatever worked.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4z" />
      </svg>
    ),
  },
] as const;

export function HowItWorks() {
  return (
    <section className={styles.section}>
      <div className="wrap">
        <div className={styles.head}>
          <p className="eyebrow eyebrow--dim">How it works</p>
          <h2 className={`display ${styles.title}`}>What Friday does while you ship</h2>
        </div>
        <div className={styles.grid}>
          {STEPS.map((s) => (
            <article key={s.title} className={`panel ${styles.card}`}>
              {s.icon}
              <h3 className={styles.cardTitle}>{s.title}</h3>
              <p className={styles.cardBody}>{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
