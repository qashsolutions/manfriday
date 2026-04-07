import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Fetch wrapper that attaches the Supabase JWT token to API requests.
 * Falls back to unauthenticated request if no session.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
}

/**
 * GET with auth token.
 */
export function apiGet(path: string) {
  return apiFetch(path);
}

/**
 * POST with auth token and JSON body.
 */
export function apiPost(path: string, body: unknown) {
  return apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * DELETE with auth token.
 */
export function apiDelete(path: string) {
  return apiFetch(path, { method: "DELETE" });
}
