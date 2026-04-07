"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";

const INITIAL_URLS = ["", "", ""];

export default function SetupSourcesPage() {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>(INITIAL_URLS);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<
    { url: string; ok: boolean; error?: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  function updateUrl(index: number, value: string) {
    setUrls((prev) => prev.map((u, i) => (i === index ? value : u)));
  }

  function addUrlField() {
    if (urls.length < 5) {
      setUrls((prev) => [...prev, ""]);
    }
  }

  function removeUrlField(index: number) {
    if (urls.length > 1) {
      setUrls((prev) => prev.filter((_, i) => i !== index));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validUrls = urls.filter((u) => u.trim());
    if (validUrls.length === 0) return;

    setSubmitting(true);
    setError(null);
    setResults([]);

    const ingestResults: { url: string; ok: boolean; error?: string }[] = [];

    for (const url of validUrls) {
      try {
        const res = await apiPost("/ingest", { url: url.trim() });

        if (res.ok) {
          ingestResults.push({ url, ok: true });
        } else {
          const body = await res.json().catch(() => ({}));
          ingestResults.push({ url, ok: false, error: body.detail || `Error ${res.status}` });
        }
      } catch {
        ingestResults.push({ url, ok: false, error: "Connection failed" });
      }
    }

    setResults(ingestResults);
    setSubmitting(false);

    const allOk = ingestResults.every((r) => r.ok);
    if (allOk) {
      // Auto-advance after brief pause
      setTimeout(() => router.push("/setup/schema"), 1500);
    }
  }

  function handleSkip() {
    router.push("/setup/schema");
  }

  const validCount = urls.filter((u) => u.trim()).length;

  return (
    <div className="card space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">Seed Sources</h2>
        <p className="text-gray-400 text-sm mt-1">
          Add 1-5 URLs to populate your wiki with initial content.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {urls.map((url, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => updateUrl(i, e.target.value)}
              placeholder={`https://example.com/source-${i + 1}`}
              className="input-field flex-1"
            />
            {urls.length > 1 && (
              <button
                type="button"
                onClick={() => removeUrlField(i)}
                className="p-2 text-gray-500 hover:text-red-400 transition-colors"
                aria-label="Remove URL"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}

        {urls.length < 5 && (
          <button
            type="button"
            onClick={addUrlField}
            className="text-sm text-accent hover:text-accent-hover transition-colors"
          >
            + Add another URL
          </button>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {results.length > 0 && (
          <div className="space-y-1">
            {results.map((r, i) => (
              <p key={i} className={`text-sm ${r.ok ? "text-green-400" : "text-red-400"}`}>
                {r.ok ? "Ingested" : "Failed"}: {r.url}
                {r.error && ` - ${r.error}`}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleSkip}
            className="btn-secondary flex-1"
          >
            Skip
          </button>
          <button
            type="submit"
            disabled={submitting || validCount === 0}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {submitting ? "Ingesting..." : `Ingest ${validCount} source${validCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}
