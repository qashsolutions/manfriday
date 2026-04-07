"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, apiFetch } from "@/lib/api";

const DOMAINS = [
  { value: "ai_ml", label: "AI / Machine Learning" },
  { value: "health", label: "Health & Wellness" },
  { value: "business", label: "Business & Finance" },
  { value: "personal", label: "Personal Knowledge" },
  { value: "general", label: "General" },
];

export default function SetupSchemaPage() {
  const router = useRouter();
  const [wikiName, setWikiName] = useState("");
  const [domain, setDomain] = useState("general");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!wikiName.trim()) return;

    setGenerating(true);
    setError(null);
    setPreview(null);

    try {
      const res = await apiPost("/schema/generate", { wiki_name: wikiName.trim(), domain });

      if (res.ok) {
        const data = await res.json();
        setPreview(data.schema || data.content);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || `Error: ${res.status}`);
      }
    } catch {
      setError("Could not connect to API.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!preview) return;

    setSaving(true);
    setError(null);

    try {
      const res = await apiFetch("/schema", {
        method: "PUT",
        body: JSON.stringify({ content: preview }),
      });

      if (res.ok) {
        router.push("/wiki");
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Failed to save schema.");
      }
    } catch {
      setError("Could not connect to API.");
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    router.push("/wiki");
  }

  return (
    <div className="card space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">Generate CLAUDE.md</h2>
        <p className="text-gray-400 text-sm mt-1">
          Create a schema to guide how your wiki is organized.
        </p>
      </div>

      <div>
        <label htmlFor="wiki-name" className="block text-sm font-medium text-gray-300 mb-2">
          Wiki Name
        </label>
        <input
          id="wiki-name"
          type="text"
          value={wikiName}
          onChange={(e) => setWikiName(e.target.value)}
          placeholder="My Knowledge Base"
          className="input-field w-full"
        />
      </div>

      <div>
        <label htmlFor="domain" className="block text-sm font-medium text-gray-300 mb-2">
          Domain
        </label>
        <select
          id="domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="input-field w-full"
        >
          {DOMAINS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!preview ? (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="btn-secondary flex-1"
          >
            Skip
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || !wikiName.trim()}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {generating ? "Generating..." : "Generate"}
          </button>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Preview
            </label>
            <textarea
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              rows={16}
              className="input-field w-full font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setPreview(null)}
              className="btn-secondary flex-1"
            >
              Regenerate
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save & Finish"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
