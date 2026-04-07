"use client";

import { useEffect, useState } from "react";
import SourceQualityBadge from "@/components/SourceQualityBadge";
import { apiGet, apiPost } from "@/lib/api";

interface SuppressedSource {
  slug: string;
  title: string;
  url: string;
  quality_score: number;
  suppressed_at: string;
  reason?: string;
}

export default function SuppressedSourcesPage() {
  const [items, setItems] = useState<SuppressedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function loadSuppressed() {
    try {
      const res = await apiGet("/sources/suppressed");
      if (res.ok) {
        setItems(await res.json());
      } else {
        setError(`Failed to load suppressed sources: ${res.status}`);
      }
    } catch {
      setError("Could not connect to API. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSuppressed();
  }, []);

  async function handleRestore(slug: string) {
    setRestoring(slug);

    try {
      const res = await apiPost(`/sources/suppressed/${slug}/restore`, {});

      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.slug !== slug));
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Failed to restore source.");
      }
    } catch {
      setError("Could not connect to API.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Suppressed Sources</h1>
        <p className="text-gray-500 text-sm">
          Sources that were suppressed due to low quality scores or manual action.
        </p>
      </div>

      {error && (
        <div className="card border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse h-20" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card text-gray-500 text-center py-12">
          No suppressed sources. All sources are active.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.slug} className="card flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">
                  {item.title || item.slug}
                </p>
                <p className="text-xs text-gray-500 truncate">{item.url}</p>
                {item.reason && (
                  <p className="text-xs text-gray-600 mt-1">Reason: {item.reason}</p>
                )}
              </div>
              <SourceQualityBadge score={item.quality_score} />
              <span className="text-xs text-gray-600 flex-shrink-0">
                {item.suppressed_at}
              </span>
              <button
                onClick={() => handleRestore(item.slug)}
                disabled={restoring === item.slug}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                {restoring === item.slug ? "Restoring..." : "Restore"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
