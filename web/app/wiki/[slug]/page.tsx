"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import WikiRenderer from "@/components/WikiRenderer";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface WikiPage {
  slug: string;
  title: string;
  type: string;
  content: string;
  created: string;
  updated: string;
  tags: string[];
  sources: string[];
  source_count: number;
}

interface Backlink {
  slug: string;
  title: string;
  type: string;
}

export default function ArticleView() {
  const params = useParams();
  const slug = params.slug as string;

  const [page, setPage] = useState<WikiPage | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [pageRes, blRes] = await Promise.all([
          fetch(`${API}/wiki/pages/${slug}`),
          fetch(`${API}/wiki/pages/${slug}/backlinks`),
        ]);

        if (!pageRes.ok) {
          setError(pageRes.status === 404 ? "Page not found." : "Failed to load page.");
          return;
        }

        setPage(await pageRes.json());
        if (blRes.ok) {
          setBacklinks(await blRes.json());
        }
      } catch (e) {
        setError("Could not connect to API.");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card animate-pulse h-96" />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="card text-center py-16">
          <p className="text-gray-400 text-lg">{error || "Page not found."}</p>
          <Link href="/wiki" className="text-accent hover:text-accent-hover text-sm mt-4 inline-block">
            Back to Wiki Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto flex gap-6">
      {/* Main content */}
      <article className="flex-1 min-w-0">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-surface-2 border border-surface-3 text-gray-400">
              {page.type}
            </span>
            {page.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20"
              >
                {tag}
              </span>
            ))}
          </div>
          <h1 className="text-2xl font-bold text-white">{page.title}</h1>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span>Created {page.created}</span>
            <span>Updated {page.updated}</span>
            <span>{page.source_count} source{page.source_count !== 1 && "s"}</span>
          </div>
        </div>

        {/* Body */}
        <div className="card">
          <WikiRenderer content={page.content} />
        </div>

        {/* Sources */}
        {page.sources.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Sources</h3>
            <div className="flex flex-wrap gap-2">
              {page.sources.map((src) => (
                <Link
                  key={src}
                  href={`/wiki/${src}`}
                  className="text-xs px-2 py-1 rounded bg-surface-2 border border-surface-3 text-gray-300 hover:text-accent hover:border-accent/30 transition-colors"
                >
                  {src}
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>

      {/* Backlinks panel */}
      <aside className="hidden lg:block w-64 flex-shrink-0">
        <div className="sticky top-20">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Backlinks ({backlinks.length})
          </h3>
          {backlinks.length === 0 ? (
            <p className="text-xs text-gray-600">No pages link here yet.</p>
          ) : (
            <div className="space-y-2">
              {backlinks.map((bl) => (
                <Link
                  key={bl.slug}
                  href={`/wiki/${bl.slug}`}
                  className="block p-2 rounded-lg bg-surface-1 border border-surface-3 hover:border-accent/30 transition-colors"
                >
                  <p className="text-sm text-gray-200 truncate">{bl.title}</p>
                  <p className="text-xs text-gray-500">{bl.type}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
