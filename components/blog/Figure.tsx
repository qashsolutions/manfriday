import type { ReactNode } from "react";
import styles from "@/app/(marketing)/blog/blog.module.css";

/** Full-width illustrated figure inside a post. Illustrations are inline SVG
 *  that use the site's CSS tokens, so they follow dark/light mode for free. */
export function Figure({ children, caption, bleed = true }: { children: ReactNode; caption?: string; bleed?: boolean }) {
  return (
    <figure className={bleed ? `${styles.figure} ${styles.figureBleed}` : styles.figure}>
      <div className={styles.figureFrame}>{children}</div>
      {caption && <figcaption className={`mono ${styles.figcaption}`}>{caption}</figcaption>}
    </figure>
  );
}
