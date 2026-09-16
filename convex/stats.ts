import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { currentUserId } from "./users";
import { ensureGoogleAccessToken } from "./google";
import { dailyLimit, quotaKey } from "./youtubeQuota";

/** YouTube view counts for the Shorts Man Friday published — the youtube.readonly
 *  half of what we declared to Google (OAuth verification + quota audit, Sep 2026):
 *    • videos.list, part=statistics, id=<our own video IDs>, ≤50 per call, 1 unit
 *    • at most once per day per account (daily cron), never on page load
 *    • snapshots older than 30 days are pruned; everything is deleted on
 *      disconnect, auth expiry, or account deletion (see oauth.ts, account.ts)
 *  TikTok stats need a scope we have not requested — not fetched. */

const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH = 50; // videos.list id limit per request

/** Daily cron entry point: fan out one action per connected YouTube account,
 *  staggered so a big cohort doesn't burst the API. */
export const refreshAll = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const accounts = await ctx.db
      .query("socialAccounts")
      .withIndex("by_platform_and_status", (q) => q.eq("platform", "youtube").eq("status", "connected"))
      .take(1000);
    accounts.forEach((a, i) => {
      void ctx.scheduler.runAfter(i * 3000, internal.stats.refreshAccount, { accountId: a._id });
    });
    return accounts.length;
  },
});

export const livePublicationsForAccount = internalQuery({
  args: { accountId: v.id("socialAccounts") },
  handler: async (ctx: QueryCtx, args) => {
    const rows = await ctx.db
      .query("publications")
      .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
      .take(500);
    return rows
      .filter((p) => p.status === "live" && !!p.platformPostId)
      .map((p) => ({ publicationId: p._id, videoId: p.platformPostId as string }));
  },
});

export const refreshAccount = internalAction({
  args: { accountId: v.id("socialAccounts") },
  handler: async (ctx: ActionCtx, args): Promise<{ videos: number; units: number } | null> => {
    const account: Doc<"socialAccounts"> | null = await ctx.runQuery(internal.oauth.getAccountForPublish, {
      accountId: args.accountId,
    });
    if (!account || account.platform !== "youtube") return null;
    const pubs = await ctx.runQuery(internal.stats.livePublicationsForAccount, { accountId: args.accountId });
    if (pubs.length === 0) return { videos: 0, units: 0 };

    const fresh = await ensureGoogleAccessToken(ctx, account);
    if (fresh.token === null) return null; // tokens wiped + metrics purge scheduled by markAuthExpired

    let units = 0;
    let videos = 0;
    for (let i = 0; i < pubs.length; i += BATCH) {
      const chunk = pubs.slice(i, i + BATCH);
      const ids = chunk.map((c) => c.videoId).join(",");
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(ids)}`,
        { headers: { Authorization: `Bearer ${fresh.token}` } },
      );
      units += 1;
      if (resp.status === 401) {
        await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
        return null;
      }
      if (resp.status === 403) {
        // Quota exhausted for today — stop, never hammer; tomorrow's run catches up.
        console.warn("youtube stats: 403 (quota?)", (await resp.text()).slice(0, 200));
        break;
      }
      if (!resp.ok) {
        console.warn("youtube stats: unexpected", resp.status);
        break;
      }
      const data = (await resp.json()) as {
        items?: Array<{ id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
      };
      const byId = new Map((data.items ?? []).map((it) => [it.id, it.statistics ?? {}]));
      const snapshots = chunk.flatMap((c) => {
        const st = byId.get(c.videoId);
        if (!st) return []; // deleted on YouTube by the user — nothing to record
        return [{
          publicationId: c.publicationId,
          views: Number(st.viewCount ?? 0),
          likes: Number(st.likeCount ?? 0),
          comments: Number(st.commentCount ?? 0),
        }];
      });
      await ctx.runMutation(internal.stats.recordSnapshots, { snapshots });
      videos += snapshots.length;
    }
    await ctx.runMutation(internal.stats.countUnits, { units });
    return { videos, units };
  },
});

export const recordSnapshots = internalMutation({
  args: {
    snapshots: v.array(
      v.object({
        publicationId: v.id("publications"),
        views: v.number(),
        likes: v.number(),
        comments: v.number(),
      }),
    ),
  },
  handler: async (ctx: MutationCtx, args) => {
    const now = Date.now();
    const cutoff = now - SNAPSHOT_RETENTION_MS;
    for (const s of args.snapshots) {
      await ctx.db.insert("metrics", { ...s, shares: 0, capturedAt: now });
      // Prune snapshots older than 30 days (authorized data must be refreshed or deleted).
      const stale = await ctx.db
        .query("metrics")
        .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", s.publicationId).lt("capturedAt", cutoff))
        .take(100);
      for (const m of stale) await ctx.db.delete("metrics", m._id);
    }
    return null;
  },
});

/** Daily quota ledger, so the Analytics page (and we) can see units used. */
export const countUnits = internalMutation({
  args: { units: v.number() },
  handler: async (ctx: MutationCtx, args) => {
    // Keyed by the Pacific-time quota day (YouTube resets at midnight PT), shared with the upload gate.
    const key = quotaKey(Date.now());
    const row = await ctx.db.query("quotaCounters").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (row) await ctx.db.patch("quotaCounters", row._id, { used: row.used + args.units });
    else await ctx.db.insert("quotaCounters", { key, used: args.units, limit: dailyLimit(env.YOUTUBE_DAILY_QUOTA) });
    return null;
  },
});

/** Delete every stored snapshot for an account's publications — on disconnect,
 *  auth expiry, or when the grant is revoked at Google. */
export const purgeMetricsForAccount = internalMutation({
  args: { accountId: v.id("socialAccounts") },
  handler: async (ctx: MutationCtx, args) => {
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_accountId", (q) => q.eq("accountId", args.accountId))
      .take(1000);
    let n = 0;
    for (const p of pubs) {
      const rows = await ctx.db
        .query("metrics")
        .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", p._id))
        .take(1000);
      for (const m of rows) {
        await ctx.db.delete("metrics", m._id);
        n += 1;
      }
    }
    return n;
  },
});

/** The Analytics screen: one row per published post with the latest counts,
 *  the 7-day change, and tracked clicks. Plain stats, no model. */
export const myAnalytics = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const rows = [];
    let lastCapturedAt: number | null = null;
    for (const post of posts) {
      const concept = await ctx.db.get("concepts", post.conceptId);
      const slots = (concept?.slots as Record<string, string>) ?? {};
      const pubs = await ctx.db
        .query("publications")
        .withIndex("by_postId", (q) => q.eq("postId", post._id))
        .take(5);
      const links = await ctx.db
        .query("trackedLinks")
        .withIndex("by_postId", (q) => q.eq("postId", post._id))
        .take(5);
      let clicks = 0;
      for (const l of links) {
        const c = await ctx.db
          .query("linkClicks")
          .withIndex("by_linkId_and_clickedAt", (q) => q.eq("linkId", l._id))
          .take(1000);
        clicks += c.length;
      }
      const platforms = [];
      for (const p of pubs) {
        const latest = await ctx.db
          .query("metrics")
          .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", p._id))
          .order("desc")
          .first();
        const before = await ctx.db
          .query("metrics")
          .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", p._id).lte("capturedAt", weekAgo))
          .order("desc")
          .first();
        if (latest && (lastCapturedAt === null || latest.capturedAt > lastCapturedAt)) lastCapturedAt = latest.capturedAt;
        platforms.push({
          id: p._id as Id<"publications">,
          platform: p.platform,
          status: p.status,
          url:
            p.platform === "youtube" && p.platformPostId && p.status === "live"
              ? `https://www.youtube.com/shorts/${p.platformPostId}`
              : null,
          views: latest?.views ?? null,
          likes: latest?.likes ?? null,
          comments: latest?.comments ?? null,
          viewsDelta7d: latest && before ? latest.views - before.views : null,
          capturedAt: latest?.capturedAt ?? null,
        });
      }
      rows.push({
        id: post._id,
        hook: slots.hook ?? slots.hook_text ?? slots.hook_overlay ?? "(untitled)",
        publishAt: post.publishAt,
        hasLink: links.length > 0,
        clicks,
        platforms,
      });
    }
    const totals = rows.reduce(
      (t, r) => {
        for (const p of r.platforms) {
          t.views += p.views ?? 0;
          t.likes += p.likes ?? 0;
        }
        t.clicks += r.clicks;
        return t;
      },
      { views: 0, likes: 0, clicks: 0 },
    );
    return { rows, totals, lastCapturedAt };
  },
});
