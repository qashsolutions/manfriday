"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import WikiRenderer from "@/components/WikiRenderer";
import ToolTrace, { type ToolCall } from "@/components/ToolTrace";
import OutputTypeSelector, { type OutputType } from "@/components/OutputTypeSelector";
import { apiFetch } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  outputType?: OutputType;
}

export default function QAPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [outputType, setOutputType] = useState<OutputType>("md");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (!query || streaming) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      tools: [],
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      tools: [],
      outputType,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    try {
      const res = await apiFetch("/qa", {
        method: "POST",
        body: JSON.stringify({
          question: query,
          output_type: outputType,
        }),
      });

      if (!res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${res.status} ${res.statusText}` }
              : m
          )
        );
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        setStreaming(false);
        return;
      }

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        // Parse SSE: sse_starlette sends "event: <type>\ndata: <payload>"
        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);

          if (data === "[DONE]") break;

          // Use the named event type from the "event:" line
          const eventType = currentEvent || "";
          currentEvent = ""; // reset after consuming

          try {
            if (eventType === "text") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + data }
                    : m
                )
              );
            } else if (eventType === "tool_trace") {
              const parsed = JSON.parse(data);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        tools: [
                          ...m.tools,
                          {
                            id: crypto.randomUUID(),
                            name: parsed.tool,
                            input: parsed.input,
                            status: "running" as const,
                          },
                        ],
                      }
                    : m
                )
              );
            } else if (eventType === "tool_result") {
              const parsed = JSON.parse(data);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        tools: m.tools.map((t) =>
                          t.name === parsed.tool && t.status === "running"
                            ? {
                                ...t,
                                output: parsed.result,
                                status: "success" as const,
                              }
                            : t
                        ),
                      }
                    : m
                )
              );
            } else if (eventType === "done") {
              break;
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content || "Connection error. Is the backend running?" }
            : m
        )
      );
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Q&A</h1>
          <p className="text-gray-500 text-sm">Ask questions about your knowledge base.</p>
        </div>
        <OutputTypeSelector selected={outputType} onChange={setOutputType} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-600">
              <p className="text-4xl mb-4">?</p>
              <p>Ask anything about your wiki.</p>
              <p className="text-sm mt-1">
                Try: &quot;Summarize what I know about X&quot;
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === "user" ? (
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-accent/15 border border-accent/20 rounded-xl px-4 py-3 text-sm text-gray-200">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div className="max-w-[90%]">
                <ToolTrace tools={msg.tools} />
                {msg.content ? (
                  <div className="card">
                    <WikiRenderer content={msg.content} />
                  </div>
                ) : streaming && msg.id === messages[messages.length - 1]?.id ? (
                  <div className="card">
                    <span className="inline-block w-2 h-4 bg-accent animate-pulse rounded-sm" />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-surface-3 pt-4">
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            className="input-field flex-1 resize-none min-h-[44px] max-h-32"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="btn-primary px-6 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {streaming ? "..." : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}
