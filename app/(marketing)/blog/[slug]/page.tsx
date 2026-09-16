import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { mdxComponents } from "@/components/blog/mdx-components";
import { getAllPosts, getPost, formatDate } from "@/lib/blog";
import { SITE } from "@/lib/site";
import styles from "../blog.module.css";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      url: `/blog/${post.slug}`,
      images: [{ url: `/api/og?title=${encodeURIComponent(post.title)}`, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: [`/api/og?title=${encodeURIComponent(post.title)}`] },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url: `${SITE.url}/blog/${post.slug}`,
    author: { "@type": "Organization", name: SITE.name, url: SITE.url },
  };

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className={styles.postHead}>
        <Link href="/blog" className={`mono ${styles.backlink}`}>
          ← All posts
        </Link>
        <p className={`mono ${styles.meta}`}>
          {formatDate(post.date)}
          {post.tags.length > 0 && <> · {post.tags.join(" · ")}</>}
          {" · "}{post.readingMinutes} min read
        </p>
        <h1 className={`display ${styles.postTitle}`}>{post.title}</h1>
      </header>
      <article className={styles.prose}>
        <MDXRemote source={post.content} components={mdxComponents} />
      </article>
      <footer className={styles.postFoot}>
        <p>
          Man Friday drafts and posts short-form video for your product — you approve with a
          swipe. Built in public for solo builders.
        </p>
        <Link href="/" className="btn btn--accent" style={{ fontSize: 15, padding: "12px 26px" }}>
          Meet Friday →
        </Link>
      </footer>
    </div>
  );
}
