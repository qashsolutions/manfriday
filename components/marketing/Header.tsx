import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Bolt, Wordmark } from "@/components/ui/Logo";
import { ModeToggle } from "@/components/ui/ModeToggle";
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
          <Link href="/blog" className={`${styles.link} ${styles.navOnly}`}>
            Blog
          </Link>
          <Link href="/pricing" className={`${styles.link} ${styles.navOnly}`}>
            Pricing
          </Link>
          <ModeToggle />
          <Show when="signed-out">
            <Link href="/login" className={styles.link}>
              Log in
            </Link>
            <Link href="/signup" className={`btn btn--accent ${styles.cta}`}>
              Start free
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/picks" className={`btn btn--accent ${styles.cta}`}>
              Open Friday →
            </Link>
          </Show>
        </nav>
      </div>
    </header>
  );
}
