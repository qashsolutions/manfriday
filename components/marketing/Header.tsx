import Link from "next/link";
import { Bolt, Wordmark } from "@/components/ui/Logo";
import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="Man Friday home">
          <Bolt />
          <Wordmark />
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/blog" className={styles.link}>
            Blog
          </Link>
          <Link href="/pricing" className={styles.link}>
            Pricing
          </Link>
          <Link href="/login" className={styles.link}>
            Log in
          </Link>
          <Link href="/signup" className="btn btn--accent" style={{ padding: "11px 22px", fontSize: 15 }}>
            Start free
          </Link>
        </nav>
      </div>
    </header>
  );
}
