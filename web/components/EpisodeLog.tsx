"use client";

import { useState, useMemo } from "react";

interface Episode {
  date: string;
  query: string;
  topics_detected: string[];
  output_type: string;
  filed: boolean;
}

interface EpisodeLogProps {
  episodes: Episode[];
}

const PAGE_SIZE = 10;

export default function EpisodeLog({ episodes }: EpisodeLogProps) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(episodes.length / PAGE_SIZE));

  const pageEpisodes = useMemo(() => {
    const start = page * PAGE_SIZE;
    return episodes.slice(start, start + PAGE_SIZE);
  }, [episodes, page]);

  const goToPrev = () => setPage((p) => Math.max(0, p - 1));
  const goToNext = () => setPage((p) => Math.min(totalPages - 1, p + 1));

  return (
    <div className="border border-surface-3 bg-surface-2 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-3 bg-surface-1 text-left text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Query</th>
              <th className="px-4 py-3">Topics</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Filed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {pageEpisodes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No episodes recorded.
                </td>
              </tr>
            ) : (
              pageEpisodes.map((ep, idx) => (
                <tr
                  key={`${ep.date}-${idx}`}
                  className="hover:bg-surface-3/50 transition-colors"
                >
                  <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap tabular-nums">
                    {ep.date}
                  </td>
                  <td className="px-4 py-2.5 text-gray-200 max-w-xs truncate" title={ep.query}>
                    {ep.query}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {ep.topics_detected.map((t) => (
                        <span
                          key={t}
                          className="inline-block px-1.5 py-0.5 bg-surface-3 text-gray-300 rounded text-xs"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                    {ep.output_type}
                  </td>
                  <td className="px-4 py-2.5">
                    {ep.filed ? (
                      <span className="text-green-400 text-xs font-medium">Yes</span>
                    ) : (
                      <span className="text-gray-500 text-xs">No</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-surface-3">
          <span className="text-xs text-gray-500">
            {episodes.length} episode{episodes.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={goToPrev}
              disabled={page === 0}
              className="px-2.5 py-1 text-xs rounded border border-surface-3 text-gray-400 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <span className="text-xs text-gray-400 tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={goToNext}
              disabled={page === totalPages - 1}
              className="px-2.5 py-1 text-xs rounded border border-surface-3 text-gray-400 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
