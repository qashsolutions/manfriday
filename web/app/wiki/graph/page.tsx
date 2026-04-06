"use client";

import { useEffect, useState, useRef } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface BacklinkNode {
  id: string;
  label: string;
}

interface BacklinkEdge {
  source: string;
  target: string;
}

export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<BacklinkNode[]>([]);
  const [edges, setEdges] = useState<BacklinkEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBacklinks() {
      try {
        const res = await fetch(`${API}/wiki/backlinks.md`);
        if (!res.ok) {
          setError(`Failed to load backlinks: ${res.status}`);
          return;
        }

        const text = await res.text();
        const nodeSet = new Set<string>();
        const parsedEdges: BacklinkEdge[] = [];

        // Parse backlinks.md — expected format: [[source]] -> [[target]]
        const lines = text.split("\n");
        for (const line of lines) {
          const matches = line.match(/\[\[([^\]]+)\]\]/g);
          if (matches && matches.length >= 2) {
            const source = matches[0].replace(/\[\[|\]\]/g, "");
            const target = matches[1].replace(/\[\[|\]\]/g, "");
            nodeSet.add(source);
            nodeSet.add(target);
            parsedEdges.push({ source, target });
          } else if (matches && matches.length === 1) {
            nodeSet.add(matches[0].replace(/\[\[|\]\]/g, ""));
          }
        }

        setNodes(Array.from(nodeSet).map((id) => ({ id, label: id })));
        setEdges(parsedEdges);
      } catch {
        setError("Could not connect to API. Is the backend running?");
      } finally {
        setLoading(false);
      }
    }

    loadBacklinks();
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Concept Graph</h1>
        <p className="text-gray-500 text-sm">
          Visual map of connections between wiki pages.
        </p>
      </div>

      {error && (
        <div className="card border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          {error}
        </div>
      )}

      <div className="card" style={{ minHeight: "500px" }}>
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex items-center justify-center h-96 text-gray-500">
            <div className="text-center">
              <p className="text-lg mb-2">No connections yet</p>
              <p className="text-sm">
                Add sources and build your wiki to see the concept graph.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span>{nodes.length} nodes</span>
              <span>{edges.length} edges</span>
            </div>

            {/* D3.js force-directed graph container */}
            <svg
              ref={svgRef}
              width="100%"
              height="500"
              className="bg-surface-2 rounded-lg border border-surface-3"
              viewBox="0 0 800 500"
            >
              <text
                x="400"
                y="250"
                textAnchor="middle"
                fill="#6b7280"
                fontSize="14"
              >
                D3.js force-directed graph — mount visualization here
              </text>
            </svg>

            {/* Fallback adjacency list */}
            <details className="text-sm">
              <summary className="text-gray-400 cursor-pointer hover:text-white transition-colors">
                View adjacency list
              </summary>
              <div className="mt-3 space-y-1 max-h-64 overflow-y-auto">
                {edges.map((edge, i) => (
                  <div key={i} className="flex items-center gap-2 text-gray-400">
                    <span className="text-accent">{edge.source}</span>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    <span className="text-accent">{edge.target}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
