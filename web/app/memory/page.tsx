"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

interface Episode {
  id: string;
  query: string;
  answer_preview: string;
  timestamp: string;
  topics: string[];
}

interface Topic {
  name: string;
  mention_count: number;
  last_seen: string;
}

export default function MemoryPage() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [episodesRes, topicsRes] = await Promise.all([
          apiGet("/memory/episodes"),
          apiGet("/memory/topics"),
        ]);

        if (episodesRes.ok) {
          setEpisodes(await episodesRes.json());
        }
        if (topicsRes.ok) {
          setTopics(await topicsRes.json());
        }

        if (!episodesRes.ok && !topicsRes.ok) {
          setError("Failed to load memory data.");
        }
      } catch {
        setError("Could not connect to API. Is the backend running?");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Memory Inspector</h1>
        <p className="text-gray-500 text-sm">
          View session history and active knowledge topics.
        </p>
      </div>

      {error && (
        <div className="card border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Topics */}
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold text-white mb-4">Active Topics</h2>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="card animate-pulse h-12" />
              ))}
            </div>
          ) : topics.length === 0 ? (
            <div className="card text-gray-500 text-center py-8 text-sm">
              No topics tracked yet.
            </div>
          ) : (
            <div className="space-y-2">
              {topics.map((topic) => (
                <div key={topic.name} className="card flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{topic.name}</p>
                    <p className="text-xs text-gray-500">Last: {topic.last_seen}</p>
                  </div>
                  <span className="text-xs font-mono bg-surface-2 border border-surface-3 rounded-full px-2 py-0.5 text-gray-400">
                    {topic.mention_count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Episodes */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Episodes</h2>
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card animate-pulse h-20" />
              ))}
            </div>
          ) : episodes.length === 0 ? (
            <div className="card text-gray-500 text-center py-12 text-sm">
              No Q&A sessions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="bg-surface-2 border border-surface-3 px-3 py-2 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Query
                    </th>
                    <th className="bg-surface-2 border border-surface-3 px-3 py-2 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Preview
                    </th>
                    <th className="bg-surface-2 border border-surface-3 px-3 py-2 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Topics
                    </th>
                    <th className="bg-surface-2 border border-surface-3 px-3 py-2 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {episodes.map((ep) => (
                    <tr key={ep.id}>
                      <td className="border border-surface-3 px-3 py-2 text-sm text-white max-w-[200px] truncate">
                        {ep.query}
                      </td>
                      <td className="border border-surface-3 px-3 py-2 text-sm text-gray-400 max-w-[250px] truncate">
                        {ep.answer_preview}
                      </td>
                      <td className="border border-surface-3 px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {ep.topics.map((t) => (
                            <span
                              key={t}
                              className="text-xs bg-accent/15 text-accent border border-accent/30 rounded-full px-2 py-0.5"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="border border-surface-3 px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {ep.timestamp}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
