"use client";

import { useState } from "react";

interface RepoSourceCardProps {
  repoName: string;
  language: string;
  stars: number;
  description: string;
  fileTree?: string[];
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  Java: "#b07219",
  Ruby: "#701516",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
};

export default function RepoSourceCard({
  repoName,
  language,
  stars,
  description,
  fileTree,
}: RepoSourceCardProps) {
  const [treeOpen, setTreeOpen] = useState(false);
  const langColor = LANGUAGE_COLORS[language] ?? "#94a3b8";

  return (
    <div className="border border-surface-3 bg-surface-2 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <a
          href={`https://github.com/${repoName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent-hover font-semibold text-base hover:underline truncate"
          title={repoName}
        >
          {repoName}
        </a>
        <span className="flex items-center gap-1 text-sm text-gray-400 shrink-0">
          <svg
            className="w-4 h-4 text-yellow-400"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.448a1 1 0 00-.364 1.118l1.287 3.957c.3.921-.755 1.688-1.54 1.118l-3.37-2.448a1 1 0 00-1.176 0l-3.37 2.448c-.784.57-1.838-.197-1.539-1.118l1.287-3.957a1 1 0 00-.364-1.118L2.063 9.384c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69L9.049 2.927z" />
          </svg>
          {stars.toLocaleString()}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-400 mb-3">{description}</p>

      {/* Language badge */}
      <div className="flex items-center gap-1.5 text-xs text-gray-300">
        <span
          className="inline-block w-3 h-3 rounded-full"
          style={{ backgroundColor: langColor }}
        />
        {language}
      </div>

      {/* File tree accordion */}
      {fileTree && fileTree.length > 0 && (
        <div className="mt-3 border-t border-surface-3 pt-3">
          <button
            onClick={() => setTreeOpen(!treeOpen)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${treeOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            File tree ({fileTree.length} items)
          </button>
          {treeOpen && (
            <ul className="mt-2 ml-4 space-y-0.5 text-xs text-gray-400 font-mono max-h-48 overflow-y-auto">
              {fileTree.map((path) => (
                <li key={path} className="truncate" title={path}>
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
