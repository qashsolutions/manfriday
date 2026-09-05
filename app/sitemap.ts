import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    { url: SITE.url, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/pricing`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE.url}/blog`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE.url}/signup`, changeFrequency: "monthly", priority: 0.7 },
  ];
  const posts: MetadataRoute.Sitemap = getAllPosts().map((p) => ({
    url: `${SITE.url}/blog/${p.slug}`,
    lastModified: new Date(`${p.date}T00:00:00Z`),
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  return [...pages, ...posts];
}
