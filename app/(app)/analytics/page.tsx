import type { Metadata } from "next";
import styles from "../app.module.css";

export const metadata: Metadata = { title: "Analytics", robots: { index: false } };

export default function AnalyticsPage() {
  return (
    <div className={styles.wrap}>
      <p className="eyebrow">What paid</p>
      <h1 className={`display ${styles.title}`}>Analytics</h1>
      <div className={styles.stub}>
        Views, watch-through, and tracked clicks to your product land here with M4 — including
        &ldquo;Friday, more like this.&rdquo; Every post carries a tracked link from day one.
      </div>
    </div>
  );
}
