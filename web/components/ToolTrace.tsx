"use client";

import { useState } from "react";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status?: "running" | "success" | "error";
  duration_ms?: number;
}

interface ToolTraceProps {
  tools: ToolCall[];
}

export default function ToolTrace({ tools }: ToolTraceProps) {
  if (tools.length === 0) return null;

  return (
    <div className="space-y-2 my-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        Tool calls ({tools.length})
      </p>
      {tools.map((tool) => (
        <ToolCallItem key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolCallItem({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = {
    running: "text-yellow-400",
    success: "text-green-400",
    error: "text-red-400",
  }[tool.status || "success"];

  const statusIcon = {
    running: "...",
    success: "OK",
    error: "ERR",
  }[tool.status || "success"];

  return (
    <div className="bg-surface-2 border border-surface-3 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-3/50 transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <code className="text-sm text-indigo-300 font-mono">{tool.name}</code>

        <span className={`text-xs font-mono ${statusColor} ml-auto`}>
          {statusIcon}
        </span>

        {tool.duration_ms !== undefined && (
          <span className="text-xs text-gray-600 font-mono">
            {tool.duration_ms}ms
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-surface-3">
          <div className="mt-2">
            <p className="text-xs text-gray-500 mb-1">Input</p>
            <pre className="text-xs text-gray-300 bg-surface-1 rounded p-2 overflow-x-auto font-mono">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
          {tool.output && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Output</p>
              <pre className="text-xs text-gray-300 bg-surface-1 rounded p-2 overflow-x-auto font-mono max-h-48 overflow-y-auto">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
