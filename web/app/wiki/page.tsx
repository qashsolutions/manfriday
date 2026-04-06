"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface WikiStats {
  total_pages: number;
  entities: number;
  concepts: number;
  articles: number;
}

interface ArticleSummary {
  slug: string;
  title: string;
  updated: string;
  summary: string;
  source_count: number;
}

export default function WikiHome() {
  const [stats, setStats] = useState<WikiStats>({
    total_pages: 0,
    entities: 0,
    concepts: 0,
    articles: 0,
  });
  const [recent, setRecent] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, recentRes] = await Promise.all([
          fetch(`${API}/wiki/stats`),
          fetch(`${API}/wiki/recent?limit=10`),
        ]);

        if (statsRes.ok) {
          setStats(await statsRes.json());
        }
        if (recentRes.ok) {
          setRecent(await recentRes.json());
        }
      } catch (e) {
        setError("Could not connect to API. Is the backend running?");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const statCards = [
    { label: "Total Pages", value: stats.total_pages, color: "text-indigo-400" },
    { label: "Entities", value: stats.entities, color: "text-blue-400" },
    { label: "Concepts", value: stats.concepts, color: "text-emerald-400" },
    { label: "Articles", value: stats.articles, color: "text-amber-400" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Wiki</h1>
        <p className="text-gray-500">Your personal knowledge base at a glance.</p>
      </div>

      {error && (
        <div className="card border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>
              {loading ? "-" : s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent articles */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Recent Articles</h2>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card animate-pulse h-20" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="card text-gray-500 text-center py-12">
            No articles yet. Add a source to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {recent.map((article) => (
              <Link
                key={article.slug}
                href={`/wiki/${article.slug}`}
                className="card block hover:border-accent/50 transition-colors group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-medium text-white group-hover:text-accent-hover truncate">
                      {article.title}
                    </h3>
                    <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                      {article.summary}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-600">{article.updated}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {article.source_count} source{article.source_count !== 1 && "s"}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
