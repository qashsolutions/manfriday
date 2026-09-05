import type { Metadata } from "next";
import Link from "next/link";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className={styles.authCol} style={{ minHeight: "calc(100vh - 61px)" }}>
      <div className={`panel ${styles.card}`}>
        <div>
          <h1 className={styles.cardTitle}>Sign in</h1>
          <p className={styles.cardSub}>Welcome back — Friday kept the queue warm.</p>
        </div>
        {/* Clerk mounts here in M2 */}
        <div className={styles.betaNote}>
          <span className={`mono ${styles.betaLabel}`}>PRIVATE BETA</span>
          <p>Sign-in opens with the first founding batch.</p>
        </div>
      </div>
      <p className={styles.signin}>
        New here? <Link href="/signup">Hire Friday</Link>
      </p>
    </div>
  );
}
