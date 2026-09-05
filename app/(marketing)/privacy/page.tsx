import type { Metadata } from "next";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Privacy Policy", robots: { index: false } };

export default function PrivacyPage() {
  return (
    <div className={`wrap ${styles.legal}`}>
      <h1 className={`display ${styles.title}`}>Privacy Policy</h1>
      <p className={`mono ${styles.status}`}>DRAFT — final policy ships with the beta launch.</p>
      <p>
        Man Friday collects the minimum needed to do the job: your account details (via our
        auth provider, Clerk), your product&apos;s public website content (to write your brand
        brief), the social accounts you explicitly connect, and product analytics that tell
        us what&apos;s working. We don&apos;t sell data. Payment details go to Stripe and
        never touch our servers.
      </p>
      <p>[FULL POLICY — reviewed before launch: data categories, retention, processors, deletion requests, contact.]</p>
    </div>
  );
}
