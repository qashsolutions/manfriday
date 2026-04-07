"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { demoFetch, mockStats, mockArticles } from "@/lib/mock-data";
import { apiGet } from "@/lib/api";

interface WikiStats {
  total_pages: number;
  entities: number;
  concepts: number;
  articles: number;
}

interface ArticleSummary {
  slug: string;
  title: string;
  updated?: string;
  created?: string;
  summary: string;
  source_count?: number;
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

  useEffect(() => {
    async function load() {
      try {
        let statsRes: Response;
        let recentRes: Response;
        try {
          statsRes = await apiGet("/wiki/stats");
          recentRes = await apiGet("/wiki/recent?limit=10");
        } catch {
          statsRes = await demoFetch("", {
            total_pages: mockStats.total_pages,
            entities: mockStats.total_entities,
            concepts: mockStats.total_concepts,
            articles: mockStats.total_articles,
          });
          recentRes = await demoFetch("", mockArticles);
        }
        if (statsRes.ok) setStats(await statsRes.json());
        else setStats({ total_pages: mockStats.total_pages, entities: mockStats.total_entities, concepts: mockStats.total_concepts, articles: mockStats.total_articles });

        if (recentRes.ok) setRecent(await recentRes.json());
        else setRecent(mockArticles as ArticleSummary[]);
      } catch {
        setStats({
          total_pages: mockStats.total_pages,
          entities: mockStats.total_entities,
          concepts: mockStats.total_concepts,
          articles: mockStats.total_articles,
        });
        setRecent(mockArticles as ArticleSummary[]);
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

      {/* Knowledge Graph card */}
      <div>
        <Link href="/wiki/graph" className="card block hover:border-accent/50 transition-colors group">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold group-hover:text-accent transition-colors">Knowledge Graph</h2>
              <p className="text-sm text-secondary mt-1">
                See how your entities and concepts connect. Interactive force-directed visualization of relationships extracted from your wiki.
              </p>
            </div>
            <div className="flex-shrink-0 ml-4">
              <svg className="w-16 h-16 text-accent/30 group-hover:text-accent/60 transition-colors" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <circle cx="32" cy="16" r="6" />
                <circle cx="14" cy="48" r="6" />
                <circle cx="50" cy="48" r="6" />
                <circle cx="52" cy="22" r="4" />
                <circle cx="12" cy="26" r="4" />
                <path d="M30 22L16 42" />
                <path d="M34 22l14 20" />
                <path d="M20 48h24" />
                <path d="M37 18l13 5" />
                <path d="M27 18l-13 7" />
              </svg>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
