import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Get the current Supabase access token.
 * Tries supabase.auth.getSession() first, then falls back to localStorage.
 */
async function getAccessToken(): Promise<string | null> {
  // Try the Supabase SDK first
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      return data.session.access_token;
    }
  } catch {}

  // Fallback: read from localStorage directly
  if (typeof window !== "undefined") {
    // Supabase stores session under a key like sb-{ref}-auth-token
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (token) return token;
          }
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Fetch wrapper that attaches the Supabase JWT token to API requests.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();

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

export function apiGet(path: string) {
  return apiFetch(path);
}

export function apiPost(path: string, body: unknown) {
  return apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function apiDelete(path: string) {
  return apiFetch(path, { method: "DELETE" });
}
