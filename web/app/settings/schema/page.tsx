"use client";

import { useEffect, useState } from "react";
import { apiGet, apiFetch } from "@/lib/api";

export default function SchemaEditorPage() {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function loadSchema() {
      try {
        const res = await apiGet("/schema");
        if (res.ok) {
          const data = await res.json();
          const text = data.content || data.schema || "";
          setContent(text);
          setOriginalContent(text);
        } else {
          setError(`Failed to load schema: ${res.status}`);
        }
      } catch {
        setError("Could not connect to API. Is the backend running?");
      } finally {
        setLoading(false);
      }
    }

    loadSchema();
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    try {
      const res = await apiFetch("/schema", {
        method: "PUT",
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        setOriginalContent(content);
        setMessage({ text: "Schema saved successfully.", type: "success" });
      } else {
        const body = await res.json().catch(() => ({}));
        setMessage({ text: body.detail || "Failed to save.", type: "error" });
      }
    } catch {
      setMessage({ text: "Could not connect to API.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setContent(originalContent);
    setMessage(null);
  }

  const hasChanges = content !== originalContent;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">CLAUDE.md Editor</h1>
          <p className="text-gray-500 text-sm">
            Edit your wiki schema and agent instructions.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="btn-secondary disabled:opacity-40"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="btn-primary disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          {error}
        </div>
      )}

      {message && (
        <p
          className={`text-sm ${
            message.type === "success" ? "text-green-400" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}

      {loading ? (
        <div className="card animate-pulse h-96" />
      ) : (
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setMessage(null);
          }}
          rows={30}
          className="input-field w-full font-mono text-sm leading-relaxed"
          spellCheck={false}
        />
      )}

      {hasChanges && (
        <p className="text-xs text-yellow-400">You have unsaved changes.</p>
      )}
    </div>
  );
}
