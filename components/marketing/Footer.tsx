import Link from "next/link";
import { Bolt } from "@/components/ui/Logo";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.brand}>
          <Bolt size={16} color="var(--faint)" />
          <span className={`mono ${styles.copyright}`}>
            © {new Date().getFullYear()} Man Friday · manfriday.app
          </span>
        </div>
        <nav className={styles.links} aria-label="Legal">
          <Link href="/blog">Blog</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </div>
    </footer>
  );
}
