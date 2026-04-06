"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface OutputItem {
  filename: string;
  title: string;
  created: string;
  summary?: string;
}

export default function OutputsPage() {
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOutputs() {
      try {
        const res = await fetch(`${API}/outputs`);
        if (res.ok) {
          setOutputs(await res.json());
        } else {
          setError(`Failed to load outputs: ${res.status}`);
        }
      } catch {
        setError("Could not connect to API. Is the backend running?");
      } finally {
        setLoading(false);
      }
    }

    loadOutputs();
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Outputs</h1>
        <p className="text-gray-500 text-sm">Filed Q&A results and generated content.</p>
      </div>

      {error && (
        <div className="card border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse h-32" />
          ))}
        </div>
      ) : outputs.length === 0 ? (
        <div className="card text-gray-500 text-center py-16">
          <p className="text-lg mb-2">No outputs yet</p>
          <p className="text-sm">
            Ask questions in Q&A and file the results to see them here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {outputs.map((output) => {
            const slug = output.filename.replace(/\.md$/, "");
            return (
              <Link
                key={output.filename}
                href={`/wiki/${slug}`}
                className="card hover:border-accent/50 transition-colors group"
              >
                <h3 className="font-medium text-white group-hover:text-accent-hover truncate">
                  {output.title || output.filename}
                </h3>
                {output.summary && (
                  <p className="text-sm text-gray-400 mt-2 line-clamp-3">
                    {output.summary}
                  </p>
                )}
                <p className="text-xs text-gray-600 mt-3">{output.created}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
