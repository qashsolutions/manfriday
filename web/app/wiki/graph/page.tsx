"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

// ── Types matching graph.json schema ──────────────────────

interface GraphEntity {
  id: string;
  name: string;
  type: "person" | "org" | "project" | "concept";
  confidence: number;
  first_mention: string;
  appearances: number;
}

interface GraphRelationship {
  source: string;
  target: string;
  type: string;
  confidence: number;
  source_page: string;
}

interface GraphData {
  entities: Record<string, GraphEntity>;
  relationships: GraphRelationship[];
}

// ── Layout node with position ─────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  appearances: number;
}

// ── Mock data fallback ────────────────────────────────────

const MOCK_DATA: GraphData = {
  entities: {
    "openai": { id: "openai", name: "OpenAI", type: "org", confidence: 1.0, first_mention: "2024-01-01", appearances: 5 },
    "anthropic": { id: "anthropic", name: "Anthropic", type: "org", confidence: 1.0, first_mention: "2024-01-01", appearances: 4 },
    "transformer": { id: "transformer", name: "Transformer Architecture", type: "concept", confidence: 1.0, first_mention: "2024-01-01", appearances: 8 },
    "attention": { id: "attention", name: "Attention Mechanism", type: "concept", confidence: 1.0, first_mention: "2024-01-01", appearances: 6 },
    "gpt-4": { id: "gpt-4", name: "GPT-4", type: "project", confidence: 0.95, first_mention: "2024-01-15", appearances: 3 },
    "claude": { id: "claude", name: "Claude", type: "project", confidence: 0.95, first_mention: "2024-02-01", appearances: 3 },
    "rlhf": { id: "rlhf", name: "RLHF", type: "concept", confidence: 0.9, first_mention: "2024-01-10", appearances: 4 },
  },
  relationships: [
    { source: "openai", target: "gpt-4", type: "creates", confidence: 0.95, source_page: "openai" },
    { source: "anthropic", target: "claude", type: "creates", confidence: 0.95, source_page: "anthropic" },
    { source: "gpt-4", target: "transformer", type: "uses", confidence: 0.9, source_page: "gpt-4" },
    { source: "claude", target: "transformer", type: "uses", confidence: 0.9, source_page: "claude" },
    { source: "transformer", target: "attention", type: "uses", confidence: 0.95, source_page: "transformer" },
    { source: "openai", target: "anthropic", type: "competes_with", confidence: 0.85, source_page: "openai" },
    { source: "gpt-4", target: "rlhf", type: "uses", confidence: 0.8, source_page: "gpt-4" },
    { source: "claude", target: "rlhf", type: "uses", confidence: 0.8, source_page: "claude" },
  ],
};

// ── Color mapping by entity type ──────────────────────────

const TYPE_COLORS: Record<string, string> = {
  person: "#f59e0b",   // amber
  org: "#3b82f6",      // blue
  project: "#10b981",  // emerald
  concept: "#a78bfa",  // violet
};

const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  org: "Organization",
  project: "Project",
  concept: "Concept",
};

// ── Simple force-directed layout ──────────────────────────

function forceLayout(
  nodes: LayoutNode[],
  edges: GraphRelationship[],
  width: number,
  height: number,
  iterations: number = 300,
): LayoutNode[] {
  // Initialize positions spread across the full space
  const cx = width / 2;
  const cy = height / 2;
  const padding = 80;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;

  // For few nodes (<10): place in a large circle filling 80% of space
  // For many nodes: place in a grid pattern
  if (nodes.length <= 12) {
    const radius = Math.min(usableW, usableH) * 0.4;
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      n.x = cx + radius * Math.cos(angle);
      n.y = cy + radius * Math.sin(angle);
      n.vx = 0;
      n.vy = 0;
    });
  } else {
    const cols = Math.ceil(Math.sqrt(nodes.length * (usableW / usableH)));
    const rows = Math.ceil(nodes.length / cols);
    const cellW = usableW / cols;
    const cellH = usableH / rows;
    nodes.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      n.x = padding + cellW * (col + 0.5);
      n.y = padding + cellH * (row + 0.5);
      n.vx = 0;
      n.vy = 0;
    });
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    // Scale forces based on node count — fewer nodes need more spread
    const nodeScale = Math.max(1, 20 / nodes.length);
    const repulsion = 50000 * alpha * nodeScale;
    const attraction = 0.0003 * alpha;

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Only attract if nodes are far apart (> 200px), otherwise let repulsion dominate
      const idealDist = 200;
      const force = Math.max(0, (dist - idealDist)) * attraction;
      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force;
      b.vy -= dy * force;
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.0005;
      n.vy += (cy - n.y) * 0.0005;
    }

    // Apply velocity with damping
    for (const n of nodes) {
      n.vx *= 0.7;
      n.vy *= 0.7;
      n.x += n.vx;
      n.y += n.vy;
      // Clamp to bounds
      n.x = Math.max(60, Math.min(width - 60, n.x));
      n.y = Math.max(60, Math.min(height - 60, n.y));
    }
  }

  return nodes;
}

// ── Main component ────────────────────────────────────────

export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [dimensions, setDimensions] = useState({ width: 1200, height: 700 });

  // Fetch graph data from API with fallback to mock
  useEffect(() => {
    async function loadGraph() {
      try {
        const res = await apiGet("/graph");
        if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        }

        const data: GraphData = await res.json();

        // If graph is empty, fall back to mock
        if (
          Object.keys(data.entities || {}).length === 0 &&
          (data.relationships || []).length === 0
        ) {
          setGraphData(MOCK_DATA);
          setIsMock(true);
        } else {
          setGraphData(data);
          setIsMock(false);
        }
      } catch {
        // Fall back to mock data
        setGraphData(MOCK_DATA);
        setIsMock(true);
        setError("Could not load graph from API. Showing sample data.");
      } finally {
        setLoading(false);
      }
    }

    loadGraph();
  }, []);

  // Measure container and compute layout when graph data changes
  useEffect(() => {
    if (!graphData) return;

    // Measure actual container dimensions
    const W = containerRef.current?.clientWidth || 1200;
    const H = Math.max(window.innerHeight * 0.7, 500);
    setDimensions({ width: W, height: H });

    const entities = Object.values(graphData.entities);
    const nodes: LayoutNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      appearances: e.appearances,
    }));

    const laid = forceLayout(nodes, graphData.relationships, W, H);
    setLayoutNodes(laid);
  }, [graphData]);

  // Re-layout on window resize
  useEffect(() => {
    function handleResize() {
      if (!graphData || !containerRef.current) return;
      const W = containerRef.current.clientWidth;
      const H = Math.max(window.innerHeight * 0.7, 500);
      setDimensions({ width: W, height: H });

      const entities = Object.values(graphData.entities);
      const nodes: LayoutNode[] = entities.map((e) => ({
        id: e.id, name: e.name, type: e.type,
        x: 0, y: 0, vx: 0, vy: 0, appearances: e.appearances,
      }));
      setLayoutNodes(forceLayout(nodes, graphData.relationships, W, H));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [graphData]);

  // Filter
  const filteredNodes =
    filterType === "all"
      ? layoutNodes
      : layoutNodes.filter((n) => n.type === filterType);
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = (graphData?.relationships || []).filter(
    (r) => filteredNodeIds.has(r.source) && filteredNodeIds.has(r.target)
  );

  const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

  // Entity details
  const selectedEntityData = selectedEntity
    ? graphData?.entities[selectedEntity]
    : null;
  const selectedRels = selectedEntity
    ? (graphData?.relationships || []).filter(
        (r) => r.source === selectedEntity || r.target === selectedEntity
      )
    : [];

  const handleNodeClick = useCallback((id: string) => {
    setSelectedEntity((prev) => (prev === id ? null : id));
  }, []);

  const entityCount = graphData ? Object.keys(graphData.entities).length : 0;
  const relCount = graphData ? graphData.relationships.length : 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/wiki" className="text-sm text-secondary hover:text-accent">Wiki</Link>
          <span className="text-muted">/</span>
          <span className="text-sm font-medium">Knowledge Graph</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">Knowledge Graph</h1>
        <p className="text-secondary text-sm">
          Your wiki as a living network. Every time ManFriday ingests a source, it extracts
          <strong> people</strong>, <strong>organizations</strong>, <strong>projects</strong>, and <strong>concepts</strong> — then
          maps how they relate. Click any node to explore its connections. The more sources you add, the richer this graph becomes.
        </p>
        {isMock && (
          <div className="mt-3 card border-accent/20 bg-accent/5 text-sm">
            <p className="font-medium text-accent">Exploring with sample data</p>
            <p className="text-secondary mt-1">
              This is a demo graph showing AI research entities. Add your own sources on the
              <Link href="/sources" className="text-accent hover:underline mx-1">Sources</Link>
              page — your personal knowledge graph will build automatically as your wiki grows.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="card border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>{entityCount} entities</span>
          <span className="text-gray-600">|</span>
          <span>{relCount} relationships</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Filter:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-surface-2 border border-surface-3 rounded px-2 py-1 text-sm text-gray-300"
          >
            <option value="all">All types</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 ml-auto">
          {Object.entries(TYPE_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1 text-xs text-gray-400">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[key] }}
              />
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ minHeight: "500px" }}>
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : entityCount === 0 ? (
          <div className="flex items-center justify-center h-96 text-gray-500">
            <div className="text-center">
              <p className="text-lg mb-2">No entities yet</p>
              <p className="text-sm">
                Add sources and build your wiki to see the world model graph.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-4">
            {/* SVG graph */}
            <div className="flex-1" ref={containerRef}>
              <svg
                ref={svgRef}
                width={dimensions.width}
                height={dimensions.height}
                className="bg-surface-2 rounded-lg border border-surface-3 w-full"
                viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
              >
                <defs>
                  <marker
                    id="arrowhead"
                    viewBox="0 0 10 7"
                    refX="10"
                    refY="3.5"
                    markerWidth="8"
                    markerHeight="6"
                    orient="auto"
                  >
                    <polygon points="0 0, 10 3.5, 0 7" fill="#4b5563" />
                  </marker>
                </defs>

                {/* Edges with animated dots */}
                {filteredEdges.map((edge, i) => {
                  const src = nodeMap.get(edge.source);
                  const tgt = nodeMap.get(edge.target);
                  if (!src || !tgt) return null;
                  const isSelected =
                    selectedEntity === edge.source ||
                    selectedEntity === edge.target;
                  const edgeId = `edge-${i}`;
                  return (
                    <g key={edgeId}>
                      <line
                        x1={src.x}
                        y1={src.y}
                        x2={tgt.x}
                        y2={tgt.y}
                        stroke={isSelected ? "#60a5fa" : "#4b5563"}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        strokeOpacity={
                          selectedEntity
                            ? isSelected
                              ? 0.9
                              : 0.15
                            : 0.6
                        }
                        markerEnd="url(#arrowhead)"
                      />
                      {/* Animated dot traveling along edge */}
                      <circle r="3" fill={isSelected ? "#60a5fa" : "#6366f1"} opacity={selectedEntity && !isSelected ? 0.1 : 0.7}>
                        <animateMotion
                          dur={`${4 + (i % 3) * 2}s`}
                          repeatCount="indefinite"
                          path={`M${src.x},${src.y} L${tgt.x},${tgt.y}`}
                        />
                      </circle>
                    </g>
                  );
                })}

                {/* Nodes */}
                {filteredNodes.map((node) => {
                  const r = Math.max(12, Math.min(28, 8 + node.appearances * 2.5));
                  const isSelected = selectedEntity === node.id;
                  const isNeighbor = selectedRels.some(
                    (rel) => rel.source === node.id || rel.target === node.id
                  );
                  const dimmed =
                    selectedEntity !== null && !isSelected && !isNeighbor;
                  return (
                    <g
                      key={node.id}
                      onClick={() => handleNodeClick(node.id)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={r}
                        fill={TYPE_COLORS[node.type] || "#6b7280"}
                        fillOpacity={dimmed ? 0.2 : 0.85}
                        stroke={isSelected ? "#ffffff" : "transparent"}
                        strokeWidth={isSelected ? 2 : 0}
                      />
                      <text
                        x={node.x}
                        y={node.y + r + 12}
                        textAnchor="middle"
                        fill={dimmed ? "#374151" : "#9ca3af"}
                        fontSize="13"
                      >
                        {node.name.length > 18
                          ? node.name.slice(0, 16) + "..."
                          : node.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Side panel — entity details */}
            {selectedEntityData && (
              <div className="w-64 flex-shrink-0 space-y-3">
                <div className="card bg-surface-2 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{
                        backgroundColor:
                          TYPE_COLORS[selectedEntityData.type] || "#6b7280",
                      }}
                    />
                    <h3 className="text-white font-semibold text-sm">
                      {selectedEntityData.name}
                    </h3>
                  </div>
                  <div className="text-xs text-gray-400 space-y-1">
                    <p>
                      Type:{" "}
                      <span className="text-gray-300">
                        {TYPE_LABELS[selectedEntityData.type] ||
                          selectedEntityData.type}
                      </span>
                    </p>
                    <p>
                      Confidence:{" "}
                      <span className="text-gray-300">
                        {(selectedEntityData.confidence * 100).toFixed(0)}%
                      </span>
                    </p>
                    <p>
                      Appearances:{" "}
                      <span className="text-gray-300">
                        {selectedEntityData.appearances}
                      </span>
                    </p>
                    <p>
                      First seen:{" "}
                      <span className="text-gray-300">
                        {selectedEntityData.first_mention || "unknown"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="card bg-surface-2 p-4 space-y-2">
                  <h4 className="text-gray-300 text-xs font-semibold uppercase tracking-wide">
                    Relationships ({selectedRels.length})
                  </h4>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {selectedRels.map((rel, i) => {
                      const isOutgoing = rel.source === selectedEntity;
                      const other = isOutgoing ? rel.target : rel.source;
                      const otherEntity = graphData?.entities[other];
                      return (
                        <div
                          key={i}
                          className="text-xs text-gray-400 flex items-center gap-1 cursor-pointer hover:text-white transition-colors"
                          onClick={() => setSelectedEntity(other)}
                        >
                          {isOutgoing ? (
                            <>
                              <span className="text-accent">
                                {rel.type.replace("_", " ")}
                              </span>
                              <svg
                                className="w-3 h-3 flex-shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                                />
                              </svg>
                              <span>
                                {otherEntity?.name || other}
                              </span>
                            </>
                          ) : (
                            <>
                              <span>
                                {otherEntity?.name || other}
                              </span>
                              <svg
                                className="w-3 h-3 flex-shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                                />
                              </svg>
                              <span className="text-accent">
                                {rel.type.replace("_", " ")}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {selectedRels.length === 0 && (
                      <p className="text-gray-600 text-xs">No relationships</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Adjacency list fallback */}
      {!loading && relCount > 0 && (
        <details className="text-sm">
          <summary className="text-gray-400 cursor-pointer hover:text-white transition-colors">
            View adjacency list
          </summary>
          <div className="mt-3 space-y-1 max-h-64 overflow-y-auto">
            {(graphData?.relationships || []).map((edge, i) => {
              const srcEntity = graphData?.entities[edge.source];
              const tgtEntity = graphData?.entities[edge.target];
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 text-gray-400"
                >
                  <span className="text-accent">
                    {srcEntity?.name || edge.source}
                  </span>
                  <span className="text-gray-600 text-xs">
                    {edge.type.replace("_", " ")}
                  </span>
                  <svg
                    className="w-4 h-4 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14 5l7 7m0 0l-7 7m7-7H3"
                    />
                  </svg>
                  <span className="text-accent">
                    {tgtEntity?.name || edge.target}
                  </span>
                  <span className="text-gray-600 text-xs ml-auto">
                    {(edge.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
