/**
 * API client for ManFriday backend.
 *
 * All HTTP calls go through this module. Auth tokens are read from
 * SecureStore and injected automatically.
 */

import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const BASE_URL: string =
  Constants.expoConfig?.extra?.apiBaseUrl ?? "http://localhost:8000";

const AUTH_TOKEN_KEY = "manfriday_jwt";

// ── Token management ────────────────────────────────────────

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}

// ── HTTP helpers ────────────────────────────────────────────

async function headers(): Promise<Record<string, string>> {
  const token = await getToken();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) {
    h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const h = await headers();

  const init: RequestInit = { method, headers: h };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(response.status, text, path);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string
  ) {
    super(`API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "ApiError";
  }
}

// ── Ingest ──────────────────────────────────────────────────

export interface IngestRequest {
  url: string;
  source_type?: string;
  tags?: string[];
}

export interface IngestResponse {
  slug: string;
  status: string;
  pages_updated: string[];
}

export async function ingest(req: IngestRequest): Promise<IngestResponse> {
  return request<IngestResponse>("POST", "/sources/ingest", req);
}

// ── Search ──────────────────────────────────────────────────

export interface SearchResult {
  slug: string;
  title: string;
  snippet: string;
  score: number;
}

export async function search(query: string): Promise<SearchResult[]> {
  return request<SearchResult[]>("GET", `/search?q=${encodeURIComponent(query)}`);
}

// ── Q&A ─────────────────────────────────────────────────────

export interface QARequest {
  question: string;
  output_type?: "concise" | "detailed" | "bullet";
}

export interface QAResponse {
  answer: string;
  sources: string[];
  filed_as?: string;
}

/**
 * Send a Q&A question. Uses SSE streaming on web, but for mobile
 * we collect the full response.
 */
export async function qa(req: QARequest): Promise<QAResponse> {
  return request<QAResponse>("POST", "/qa", req);
}

/**
 * Stream a Q&A response via SSE. Yields answer chunks as they arrive.
 */
export async function* qaStream(
  req: QARequest
): AsyncGenerator<string, void, unknown> {
  const url = `${BASE_URL}/qa/stream`;
  const h = await headers();

  const response = await fetch(url, {
    method: "POST",
    headers: h,
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text(), "/qa/stream");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body for SSE stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.chunk) {
            yield parsed.chunk;
          }
        } catch {
          // Non-JSON SSE data, yield raw
          yield data;
        }
      }
    }
  }
}

// ── Wiki pages ──────────────────────────────────────────────

export interface WikiPage {
  slug: string;
  title: string;
  type: string;
  content: string;
  tags: string[];
  sources: string[];
  created: string;
  updated: string;
}

export interface WikiStats {
  total_pages: number;
  total_sources: number;
  entities: number;
  concepts: number;
  articles: number;
  last_activity: string;
}

export async function getWikiPage(slug: string): Promise<WikiPage> {
  return request<WikiPage>("GET", `/wiki/pages/${encodeURIComponent(slug)}`);
}

export async function getWikiStats(): Promise<WikiStats> {
  return request<WikiStats>("GET", "/wiki/stats");
}

export async function getRecentPages(
  limit: number = 10
): Promise<WikiPage[]> {
  return request<WikiPage[]>("GET", `/wiki/pages/recent?limit=${limit}`);
}
