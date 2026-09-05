import styles from "./ProofBand.module.css";

/* Bracketed placeholders by convention — real numbers arrive with the first beta cohort. */
const STATS = [
  { value: "[VIEWS GENERATED]", label: "across beta accounts" },
  { value: "[POSTS SHIPPED]", label: "posted by Friday" },
  { value: "[TIME TO FIRST POST]", label: "median, from signup" },
] as const;

export function ProofBand() {
  return (
    <section className={styles.band}>
      <div className={`wrap ${styles.grid}`}>
        {STATS.map((s) => (
          <div key={s.label} className={styles.stat}>
            <span className={`display ${styles.value}`}>{s.value}</span>
            <span className={`mono ${styles.label}`}>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
