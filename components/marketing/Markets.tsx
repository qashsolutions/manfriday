import { LANGUAGES } from "@/lib/site";
import styles from "./Markets.module.css";

/* Same pick, three markets. Copy grounded in docs/language-ux.md §6. */
const CARDS = [
  {
    chip: "हिन्दी",
    style: "HINGLISH",
    hook: "6 months tak Loopnote ne $0 kamaya. phir ek cheez badli",
    meta: "SLIDESHOW · 6 SLIDES · MADE FOR LOOPNOTE",
    tone: "primary",
  },
  {
    chip: "Español",
    style: "MX",
    hook: "Loopnote ganó $0 durante 6 meses. Luego cambié una cosa",
    meta: "SAME PICK · SAME 6 SLIDES",
    tone: "plum",
  },
  {
    chip: "Bahasa Indonesia",
    style: "ID",
    hook: "Loopnote dapat $0 selama 6 bulan. Lalu saya ubah satu hal",
    meta: "SAME PICK · SAME 6 SLIDES",
    tone: "steel",
  },
] as const;

export function Markets() {
  return (
    <section className={styles.section}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.head}>
          <p className="eyebrow">Any language · every plan</p>
          <h2 className={`display ${styles.title}`}>One pick. Every market you sell to.</h2>
          <p className={styles.sub}>
            Friday reads your site&apos;s language and writes in it. Keep a pick, and one tap posts
            it in your other markets too, rewritten and voiced, not translated word for word.
            Hinglish included.
          </p>
        </div>

        <div className={styles.cards}>
          {CARDS.map((c) => (
            <div key={c.chip} className={styles.col}>
              <span className={styles.chip}>
                {c.chip}
                <span className={`mono ${styles.chipStyle}`}>{c.style}</span>
              </span>
              <article className={`${styles.card} ${styles[c.tone]}`}>
                <h3 className={styles.hook} lang={c.tone === "primary" ? "hi-Latn" : c.tone === "plum" ? "es" : "id"}>
                  {c.hook}
                </h3>
                <p className={`mono ${styles.meta}`}>{c.meta}</p>
              </article>
            </div>
          ))}
        </div>

        <p className={styles.names}>
          {LANGUAGES.map((l, i) => (
            <span key={l.code}>
              <span lang={l.code}>{l.native}</span>
              {i < LANGUAGES.length - 1 ? <span className={styles.sep} aria-hidden="true"> · </span> : null}
            </span>
          ))}
        </p>
        <p className={`mono ${styles.foot}`}>
          14 AT LAUNCH · INDIAN VOICES BY SARVAM · THE CATEGORY LEADER GATES THIS AT $149/MO
        </p>
      </div>
    </section>
  );
}
