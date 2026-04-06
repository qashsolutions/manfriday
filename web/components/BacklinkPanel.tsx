"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface BacklinkPanelProps {
  slug: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function parseBacklinks(markdown: string, slug: string): string[] {
  const lines = markdown.split("\n");
  const normalizedSlug = slug.toLowerCase().replace(/\s+/g, "-");
  const inbound: string[] = [];

  for (const line of lines) {
    // Match lines like: [[source-page]] -> [[target-page]]
    // or lines that list links pointing to our slug
    const wikilinkPattern = /\[\[([^\]]+)\]\]/g;
    const matches = [...line.matchAll(wikilinkPattern)];

    if (matches.length < 2) continue;

    // Check if any link in the line (after the first) matches our slug
    const targetMatches = matches.slice(1);
    const hasTarget = targetMatches.some(
      (m) => m[1].toLowerCase().replace(/\s+/g, "-") === normalizedSlug
    );

    if (hasTarget) {
      const source = matches[0][1];
      if (!inbound.includes(source)) {
        inbound.push(source);
      }
    }
  }

  // Also handle flat list format: lines under a heading matching our slug
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      const headingLinks = [...trimmed.matchAll(/\[\[([^\]]+)\]\]/g)];
      inSection = headingLinks.some(
        (m) => m[1].toLowerCase().replace(/\s+/g, "-") === normalizedSlug
      );
      continue;
    }

    if (inSection && trimmed.startsWith("- ")) {
      const linkMatch = trimmed.match(/\[\[([^\]]+)\]\]/);
      if (linkMatch && !inbound.includes(linkMatch[1])) {
        inbound.push(linkMatch[1]);
      }
    }

    if (inSection && trimmed === "") {
      inSection = false;
    }
  }

  return inbound;
}

export default function BacklinkPanel({ slug }: BacklinkPanelProps) {
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBacklinks() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/wiki/backlinks.md`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!cancelled) {
          setBacklinks(parseBacklinks(text, slug));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load backlinks");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBacklinks();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <aside className="w-64 shrink-0 border-l border-surface-3 bg-surface-1 p-4 overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
        Backlinks
      </h3>

      {loading && <p className="text-xs text-gray-500">Loading...</p>}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!loading && !error && backlinks.length === 0 && (
        <p className="text-xs text-gray-500">No pages link here.</p>
      )}

      {!loading && !error && backlinks.length > 0 && (
        <ul className="space-y-1.5">
          {backlinks.map((link) => {
            const href = `/wiki/${link.toLowerCase().replace(/\s+/g, "-")}`;
            return (
              <li key={link}>
                <Link
                  href={href}
                  className="text-sm text-accent hover:text-accent-hover hover:underline block truncate"
                  title={link}
                >
                  [[{link}]]
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
