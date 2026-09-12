import type { Metadata } from "next";
import { AnalyticsPanel } from "@/components/app/AnalyticsPanel";
import styles from "../app.module.css";

export const metadata: Metadata = { title: "Analytics", robots: { index: false } };

export default function AnalyticsPage() {
  return (
    <div className={styles.wrap}>
      <p className="eyebrow">What paid</p>
      <h1 className={`display ${styles.title}`}>Analytics</h1>
      <AnalyticsPanel />
    </div>
  );
}
