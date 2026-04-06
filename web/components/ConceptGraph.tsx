"use client";

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  type: string;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface ConceptGraphProps {
  data: {
    nodes: { id: string; type: string }[];
    links: { source: string; target: string }[];
  };
}

const TYPE_COLORS: Record<string, string> = {
  entity: "#3b82f6",
  concept: "#22c55e",
  article: "#f97316",
};

export default function ConceptGraph({ data }: ConceptGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const render = useCallback(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const container = svgRef.current?.parentElement;
    const width = container?.clientWidth ?? 800;
    const height = container?.clientHeight ?? 600;

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const nodes: GraphNode[] = data.nodes.map((n) => ({ ...n }));
    const links: GraphLink[] = data.links.map((l) => ({ ...l }));

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(80)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(24));

    const g = svg.append("g");

    // Zoom
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.25, 4])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        }) as never
    );

    const link = g
      .append("g")
      .attr("stroke", "#475569")
      .attr("stroke-opacity", 0.5)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1.5);

    const node = g
      .append("g")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 8)
      .attr("fill", (d) => TYPE_COLORS[d.type] ?? "#94a3b8")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5)
      .attr("cursor", "grab");

    // Tooltip label
    const label = g
      .append("g")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes)
      .join("text")
      .text((d) => d.id)
      .attr("font-size", 11)
      .attr("fill", "#e2e8f0")
      .attr("text-anchor", "middle")
      .attr("dy", -14)
      .attr("pointer-events", "none")
      .attr("opacity", 0);

    node
      .on("mouseenter", (_event, d) => {
        label.filter((l) => l.id === d.id).attr("opacity", 1);
      })
      .on("mouseleave", (_event, d) => {
        label.filter((l) => l.id === d.id).attr("opacity", 0);
      });

    // Drag
    const drag = d3
      .drag<SVGCircleElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);

      label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [data]);

  useEffect(() => {
    const cleanup = render();
    return cleanup;
  }, [render]);

  return (
    <div className="relative w-full h-full min-h-[400px] bg-surface-2 rounded-lg border border-surface-3">
      {/* Legend */}
      <div className="absolute top-3 left-3 flex gap-4 text-xs text-gray-400 z-10">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            {type}
          </span>
        ))}
      </div>
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
