import type { SupabaseClient } from "@supabase/supabase-js";

/** Postgres-backed shared cache (public.api_cache, service-role only).
    Successor to the MCP server's in-memory TTL cache: dedupes YouTube API
    fetches across users and serverless invocations — that's quota, not just
    latency. pg_cron purges expired rows every 30 minutes. */

export async function cachedJson<T>(
  svc: SupabaseClient,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const { data: hit } = await svc
    .from("api_cache")
    .select("payload")
    .eq("cache_key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (hit?.payload !== undefined && hit?.payload !== null) return hit.payload as T;

  const fresh = await fetcher();
  // Best-effort write; a race just means one redundant fetch.
  await svc.from("api_cache").upsert({
    cache_key: key,
    payload: fresh as unknown as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
  return fresh;
}
