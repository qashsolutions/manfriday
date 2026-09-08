import type { Metadata } from "next";
import styles from "../app.module.css";

export const metadata: Metadata = { title: "Calendar", robots: { index: false } };

export default function CalendarPage() {
  return (
    <div className={styles.wrap}>
      <p className="eyebrow">Friday&apos;s queue</p>
      <h1 className={`display ${styles.title}`}>Calendar</h1>
      <div className={styles.stub}>
        Scheduling and native publishing to TikTok + YouTube Shorts arrive with M3 — right
        after the platform API approvals clear. Friday picks the times; you stay in control.
      </div>
    </div>
  );
}
