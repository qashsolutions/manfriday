import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts, formatDate } from "@/lib/blog";
import styles from "./blog.module.css";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Short-form growth for solo builders: what's working on TikTok and Shorts, straight from building Man Friday in public.",
  alternates: { types: { "application/rss+xml": "/feed.xml" } },
};

export default function BlogIndex() {
  const posts = getAllPosts();
  return (
    <div className="wrap">
      <header className={styles.head}>
        <p className="eyebrow">The blog</p>
        <h1 className={`display ${styles.title}`}>Notes from Friday&apos;s desk</h1>
        <p className={styles.sub}>
          Short-form growth for solo builders — what&apos;s working on TikTok and Shorts,
          written while we build Man Friday in public.
        </p>
      </header>
      <div className={styles.list}>
        {posts.map((p) => (
          <article key={p.slug} className={`panel ${styles.card}`}>
            <p className={`mono ${styles.meta}`}>
              {formatDate(p.date)}
              {p.tags.length > 0 && <> · {p.tags.join(" · ")}</>}
            </p>
            <h2 className={styles.cardTitle}>
              <Link href={`/blog/${p.slug}`}>{p.title}</Link>
            </h2>
            <p className={styles.cardDesc}>{p.description}</p>
            <Link href={`/blog/${p.slug}`} className={`mono ${styles.readMore}`}>
              Read →
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
