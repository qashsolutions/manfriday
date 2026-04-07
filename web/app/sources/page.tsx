"use client";

import { useEffect, useState } from "react";
import SourceQualityBadge from "@/components/SourceQualityBadge";
import { apiGet, apiPost } from "@/lib/api";

interface Source {
  id: string;
  url: string;
  title: string;
  source_type: string;
  quality_score: number;
  ingested_at: string;
  status: "pending" | "ingesting" | "done" | "error";
}

const SOURCE_TYPES = [
  { value: "article", label: "Article / Blog" },
  { value: "paper", label: "Research Paper" },
  { value: "video", label: "Video / Transcript" },
  { value: "book", label: "Book / Chapter" },
  { value: "podcast", label: "Podcast" },
  { value: "thread", label: "Thread / Forum" },
  { value: "document", label: "Document" },
  { value: "other", label: "Other" },
];

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState("article");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSources() {
    try {
      const res = await apiGet("/sources");
      if (res.ok) {
        setSources(await res.json());
      }
    } catch {
      console.error("Failed to load sources");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSources();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await apiPost("/sources", { url: url.trim(), source_type: sourceType });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || `Error: ${res.status}`);
        return;
      }

      setUrl("");
      await loadSources();
    } catch {
      setError("Failed to connect to API.");
    } finally {
      setSubmitting(false);
    }
  }

  const statusBadge = (status: Source["status"]) => {
    const styles = {
      pending: "bg-gray-500/15 text-gray-400 border-gray-500/30",
      ingesting: "bg-blue-500/15 text-blue-400 border-blue-500/30",
      done: "bg-green-500/15 text-green-400 border-green-500/30",
      error: "bg-red-500/15 text-red-400 border-red-500/30",
    };
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Sources</h1>
        <p className="text-gray-500 text-sm">Manage source documents for your wiki.</p>
      </div>

      {/* Add source form */}
      <form onSubmit={handleAdd} className="card space-y-4">
        <h2 className="text-sm font-semibold text-gray-300">Add New Source</h2>

        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="input-field flex-1"
            required
          />
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className="input-field w-44"
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting || !url.trim()}
            className="btn-primary disabled:opacity-40"
          >
            {submitting ? "Adding..." : "Add"}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
      </form>

      {/* Source list */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">
          All Sources ({sources.length})
        </h2>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card animate-pulse h-16" />
            ))}
          </div>
        ) : sources.length === 0 ? (
          <div className="card text-gray-500 text-center py-12">
            No sources yet. Add a URL above to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => (
              <div
                key={source.id}
                className="card flex items-center gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">
                    {source.title || source.url}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{source.url}</p>
                </div>
                <span className="text-xs text-gray-600 font-mono flex-shrink-0">
                  {source.source_type}
                </span>
                <SourceQualityBadge score={source.quality_score} />
                {statusBadge(source.status)}
                <span className="text-xs text-gray-600 flex-shrink-0">
                  {source.ingested_at}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
