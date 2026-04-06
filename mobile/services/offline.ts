/**
 * Offline sync — cache wiki pages in SQLite + queue ingest requests.
 *
 * When the device goes offline, the user can still:
 *   - Browse recently-viewed wiki pages (cached in SQLite)
 *   - Share URLs for ingest (queued locally, synced when online)
 *
 * When connectivity returns, the sync engine:
 *   1. Flushes the ingest queue to the backend
 *   2. Refreshes stale cached pages
 */

import * as SQLite from "expo-sqlite";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { ingest, getWikiPage, IngestRequest, WikiPage } from "./api";

// ── Database setup ──────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync("manfriday_offline.db");

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cached_pages (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      sources TEXT NOT NULL DEFAULT '[]',
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingest_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      source_type TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      queued_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_cached_pages_updated
      ON cached_pages(cached_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ingest_queue_status
      ON ingest_queue(status);
  `);

  return db;
}

// ── Page cache ──────────────────────────────────────────────

const MAX_CACHED_PAGES = 200;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function cachePage(page: WikiPage): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();

  await database.runAsync(
    `INSERT OR REPLACE INTO cached_pages
     (slug, title, type, content, tags, sources, created, updated, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      page.slug,
      page.title,
      page.type,
      page.content,
      JSON.stringify(page.tags),
      JSON.stringify(page.sources),
      page.created,
      page.updated,
      now,
    ]
  );

  // Evict oldest pages if over limit
  await database.runAsync(
    `DELETE FROM cached_pages WHERE slug NOT IN (
       SELECT slug FROM cached_pages ORDER BY cached_at DESC LIMIT ?
     )`,
    [MAX_CACHED_PAGES]
  );
}

export async function getCachedPage(slug: string): Promise<WikiPage | null> {
  const database = await getDb();

  const row = await database.getFirstAsync<{
    slug: string;
    title: string;
    type: string;
    content: string;
    tags: string;
    sources: string;
    created: string;
    updated: string;
  }>("SELECT * FROM cached_pages WHERE slug = ?", [slug]);

  if (!row) return null;

  return {
    slug: row.slug,
    title: row.title,
    type: row.type,
    content: row.content,
    tags: JSON.parse(row.tags),
    sources: JSON.parse(row.sources),
    created: row.created,
    updated: row.updated,
  };
}

export async function getCachedPages(limit: number = 20): Promise<WikiPage[]> {
  const database = await getDb();

  const rows = await database.getAllAsync<{
    slug: string;
    title: string;
    type: string;
    content: string;
    tags: string;
    sources: string;
    created: string;
    updated: string;
  }>("SELECT * FROM cached_pages ORDER BY cached_at DESC LIMIT ?", [limit]);

  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    type: row.type,
    content: row.content,
    tags: JSON.parse(row.tags),
    sources: JSON.parse(row.sources),
    created: row.created,
    updated: row.updated,
  }));
}

export async function clearCache(): Promise<void> {
  const database = await getDb();
  await database.runAsync("DELETE FROM cached_pages");
}

// ── Smart page fetcher (cache-first when offline) ───────────

export async function fetchPage(slug: string): Promise<WikiPage> {
  const state = await NetInfo.fetch();

  if (state.isConnected) {
    try {
      const page = await getWikiPage(slug);
      // Update cache in background
      cachePage(page).catch(() => {});
      return page;
    } catch (error) {
      // Network error — fall through to cache
      const cached = await getCachedPage(slug);
      if (cached) return cached;
      throw error;
    }
  }

  // Offline — serve from cache
  const cached = await getCachedPage(slug);
  if (cached) return cached;

  throw new Error(`Page "${slug}" not available offline`);
}

// ── Ingest queue ────────────────────────────────────────────

export async function queueIngest(req: IngestRequest): Promise<number> {
  const database = await getDb();
  const now = new Date().toISOString();

  const result = await database.runAsync(
    `INSERT INTO ingest_queue (url, source_type, tags, queued_at)
     VALUES (?, ?, ?, ?)`,
    [req.url, req.source_type ?? null, JSON.stringify(req.tags ?? []), now]
  );

  return result.lastInsertRowId;
}

export async function getPendingIngests(): Promise<
  Array<{ id: number; url: string; source_type: string | null; tags: string[]; queued_at: string }>
> {
  const database = await getDb();

  const rows = await database.getAllAsync<{
    id: number;
    url: string;
    source_type: string | null;
    tags: string;
    queued_at: string;
  }>(
    "SELECT id, url, source_type, tags, queued_at FROM ingest_queue WHERE status = 'pending' ORDER BY queued_at ASC"
  );

  return rows.map((row) => ({
    ...row,
    tags: JSON.parse(row.tags),
  }));
}

export async function getQueueLength(): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM ingest_queue WHERE status = 'pending'"
  );
  return row?.count ?? 0;
}

// ── Sync engine ─────────────────────────────────────────────

const MAX_RETRIES = 3;
let syncInProgress = false;

export async function syncPendingIngests(): Promise<{
  synced: number;
  failed: number;
}> {
  if (syncInProgress) return { synced: 0, failed: 0 };
  syncInProgress = true;

  let synced = 0;
  let failed = 0;

  try {
    const state = await NetInfo.fetch();
    if (!state.isConnected) return { synced: 0, failed: 0 };

    const database = await getDb();
    const pending = await getPendingIngests();

    for (const item of pending) {
      try {
        await ingest({
          url: item.url,
          source_type: item.source_type ?? undefined,
          tags: item.tags,
        });

        await database.runAsync(
          "UPDATE ingest_queue SET status = 'synced' WHERE id = ?",
          [item.id]
        );
        synced++;
      } catch (error) {
        const attempts =
          ((
            await database.getFirstAsync<{ attempts: number }>(
              "SELECT attempts FROM ingest_queue WHERE id = ?",
              [item.id]
            )
          )?.attempts ?? 0) + 1;

        const newStatus = attempts >= MAX_RETRIES ? "failed" : "pending";
        const errorMsg =
          error instanceof Error ? error.message : String(error);

        await database.runAsync(
          "UPDATE ingest_queue SET status = ?, error = ?, attempts = ? WHERE id = ?",
          [newStatus, errorMsg, attempts, item.id]
        );

        if (newStatus === "failed") failed++;
      }
    }
  } finally {
    syncInProgress = false;
  }

  return { synced, failed };
}

export async function refreshStalePages(): Promise<number> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  const database = await getDb();
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  const stalePages = await database.getAllAsync<{ slug: string }>(
    "SELECT slug FROM cached_pages WHERE cached_at < ? ORDER BY cached_at ASC LIMIT 10",
    [threshold]
  );

  let refreshed = 0;
  for (const { slug } of stalePages) {
    try {
      const page = await getWikiPage(slug);
      await cachePage(page);
      refreshed++;
    } catch {
      // Skip pages that fail to refresh
    }
  }

  return refreshed;
}

// ── Auto-sync on connectivity change ────────────────────────

let unsubscribeNetInfo: (() => void) | null = null;

export function startAutoSync(): void {
  if (unsubscribeNetInfo) return;

  unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
    if (state.isConnected) {
      // Device came back online — flush queues
      syncPendingIngests().then(({ synced, failed }) => {
        if (synced > 0 || failed > 0) {
          console.log(
            `Auto-sync: ${synced} ingests synced, ${failed} failed`
          );
        }
      });

      refreshStalePages().then((count) => {
        if (count > 0) {
          console.log(`Auto-sync: refreshed ${count} stale pages`);
        }
      });
    }
  });
}

export function stopAutoSync(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
}
