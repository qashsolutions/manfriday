import { ConvexError, v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { currentUserId } from "./users";
import { ensureGoogleAccessToken } from "./google";
import { createTrackedLink, withUtm } from "./links";
import { UPLOAD_UNITS, dailyLimit, nextQuotaDayStart, quotaDay, quotaDayBounds, quotaKey, shiftDays } from "./youtubeQuota";

// Contract 3 spine: posts → publications; a minute-cron scans by_due and runs
// the platform adapter. v1 adapter = TikTok draft-to-inbox (FILE_UPLOAD), the
// pre-audit path; direct post + YouTube land as the approvals clear.

const MAX_ATTEMPTS = 3;
const MAX_QUOTA_DEFERRALS = 5;

/** Can one more YouTube upload fit in the quota day containing `ts`?
 *  used = units already spent that day (uploads + the daily stats refresh);
 *  reserved = uploads already queued for that day, across ALL users. */
async function youtubeCapacity(ctx: QueryCtx | MutationCtx, ts: number) {
  const row = await ctx.db.query("quotaCounters").withIndex("by_key", (q) => q.eq("key", quotaKey(ts))).first();
  const limit = row?.limit ?? dailyLimit(env.YOUTUBE_DAILY_QUOTA);
  const { start, end } = quotaDayBounds(ts);
  let reserved = 0;
  for (const status of ["queued", "publishing"] as const) {
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_status_and_publishAt", (q) => q.eq("status", status).gte("publishAt", start).lt("publishAt", end))
      .take(500);
    reserved += pubs.filter((p) => p.platform === "youtube").length * UPLOAD_UNITS;
  }
  return { ok: (row?.used ?? 0) + reserved + UPLOAD_UNITS <= limit, day: quotaDay(ts) };
}

/** The first time at or after `ts` (same wall-clock, later day) with room for a YouTube upload. */
async function nextOpenYoutubeSlot(ctx: QueryCtx | MutationCtx, ts: number): Promise<number | null> {
  for (let d = 1; d <= 14; d++) {
    const candidate = shiftDays(ts, d);
    if ((await youtubeCapacity(ctx, candidate)).ok) return candidate;
  }
  return null;
}

/** For the Calendar: is there room on YouTube at `publishAt`? If not, when is the next open slot? */
export const youtubeSlot = query({
  args: { publishAt: v.number() },
  handler: async (ctx: QueryCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const cap = await youtubeCapacity(ctx, args.publishAt);
    if (cap.ok) return { ok: true as const, nextOpenAt: null };
    return { ok: false as const, nextOpenAt: await nextOpenYoutubeSlot(ctx, args.publishAt) };
  },
});

/** Schedule a rendered concept. Slideshows are TikTok-only (D1). */
export const schedulePost = mutation({
  args: { conceptId: v.id("concepts"), publishAt: v.number() },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const concept = await ctx.db.get("concepts", args.conceptId);
    if (!concept || concept.userId !== userId) throw new Error("not your concept");
    if (concept.status !== "rendered" || !concept.videoId) {
      throw new Error("concept isn't fully rendered yet");
    }
    const accounts = await ctx.db
      .query("socialAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "connected"))
      .take(10);
    // D1: slideshows are TikTok-only; hook/avatar videos cross-post to Shorts.
    const template = await ctx.db.get("trendTemplates", concept.templateId);
    const targets = accounts.filter(
      (a) => a.platform === "tiktok" || (a.platform === "youtube" && template?.format !== "slideshow"),
    );
    if (targets.length === 0) throw new Error("connect a TikTok or YouTube account first");

    // Compliance rule 7: never schedule past the day's YouTube quota. The limit is
    // shared by every user until the audit clears, so the Calendar offers the
    // next open day instead of letting the upload fail at publish time.
    if (targets.some((a) => a.platform === "youtube")) {
      const cap = await youtubeCapacity(ctx, args.publishAt);
      if (!cap.ok) {
        const next = await nextOpenYoutubeSlot(ctx, args.publishAt);
        throw new ConvexError(`QUOTA_FULL|${next ?? ""}|YouTube's upload limit for that day is already spoken for.`);
      }
    }

    const caption: string = (concept.slots as Record<string, string>).caption ?? "";
    const postId = await ctx.db.insert("posts", {
      userId,
      conceptId: args.conceptId,
      publishAt: args.publishAt,
      captionByPlatform: { tiktok: caption, youtube: caption },
    });
    // North star: every post carries a tracked link to the user's product.
    // TikTok shows caption URLs as plain text (only the bio link is clickable);
    // YouTube descriptions link it. Either way the click lands on /l/<slug>.
    const brand = await ctx.db.get("brands", concept.brandId);
    if (brand?.url) {
      const short = await createTrackedLink(ctx, postId, withUtm(brand.url));
      await ctx.db.patch("posts", postId, {
        captionByPlatform: {
          tiktok: `${caption}\n\n${short.replace("https://", "")}`,
          youtube: `${caption}\n\n${short}`,
        },
      });
    }
    const publicationIds = [];
    for (const account of targets) {
      const publicationId = await ctx.db.insert("publications", {
        postId,
        accountId: account._id,
        platform: account.platform,
        status: "queued",
        publishAt: args.publishAt,
        attempts: 0,
        idempotencyKey: "",
      });
      await ctx.db.patch("publications", publicationId, { idempotencyKey: publicationId });
      publicationIds.push(publicationId);
    }
    return { postId, publicationIds };
  },
});

/** The user's queue, for the Calendar screen. */
export const myQueue = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return [];
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    const out = [];
    for (const post of posts) {
      const pubs = await ctx.db
        .query("publications")
        .withIndex("by_postId", (q) => q.eq("postId", post._id))
        .take(5);
      const concept = await ctx.db.get("concepts", post.conceptId);
      const link = await ctx.db
        .query("trackedLinks")
        .withIndex("by_postId", (q) => q.eq("postId", post._id))
        .first();
      out.push({
        id: post._id,
        publishAt: post.publishAt,
        link: link ? `manfriday.app/l/${link.slug}` : null,
        hook:
          ((concept?.slots as Record<string, string>) ?? {}).hook ??
          ((concept?.slots as Record<string, string>) ?? {}).hook_text ??
          "",
        publications: await Promise.all(
          pubs.map(async (p) => {
            // Latest daily snapshot (YouTube only for now) — shown on the queue chip.
            const latest = await ctx.db
              .query("metrics")
              .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", p._id))
              .order("desc")
              .first();
            return {
              id: p._id,
              platform: p.platform,
              status: p.status,
              publishAt: p.publishAt,
              // Pushed to the next quota day after YouTube said the daily limit was hit.
              deferred: p.status === "queued" && (p.lastError ?? "").startsWith("QUOTA_DEFERRED"),
              held: p.status === "queued" && (p.lastError ?? "").startsWith("PAUSED_HELD"),
              error: p.lastError ?? null,
              views: latest?.views ?? null,
            };
          }),
        ),
      });
    }
    return out;
  },
});

export const duePublications = internalQuery({
  args: { now: v.number() },
  handler: async (ctx: QueryCtx, args) => {
    const due = await ctx.db
      .query("publications")
      .withIndex("by_status_and_publishAt", (q) => q.eq("status", "queued").lte("publishAt", args.now))
      .take(5);
    return due.map((p) => p._id);
  },
});

export const markPublishing = internalMutation({
  args: { publicationId: v.id("publications") },
  handler: async (ctx: MutationCtx, args) => {
    const pub = await ctx.db.get("publications", args.publicationId);
    if (!pub || pub.status !== "queued") return null;
    // Paused plan: Friday holds the queue and posts when the pause ends.
    const heldPost = await ctx.db.get("posts", pub.postId);
    const owner = heldPost ? await ctx.db.get("users", heldPost.userId) : null;
    if (owner?.pausedUntil && owner.pausedUntil > Date.now()) {
      await ctx.db.patch("publications", args.publicationId, { publishAt: owner.pausedUntil, lastError: "PAUSED_HELD" });
      return null;
    }
    await ctx.db.patch("publications", args.publicationId, {
      status: "publishing",
      attempts: pub.attempts + 1,
    });
    const post = await ctx.db.get("posts", pub.postId);
    const concept = post ? await ctx.db.get("concepts", post.conceptId) : null;
    const videoUrl = concept?.videoId ? await ctx.storage.getUrl(concept.videoId) : null;
    const slots = (concept?.slots as Record<string, string>) ?? {};
    return {
      accountId: pub.accountId,
      platform: pub.platform,
      attempts: pub.attempts + 1,

      caption: post ? ((post.captionByPlatform as Record<string, string>)[pub.platform] ?? "") : "",
      title: slots.hook ?? slots.hook_text ?? "",
      videoUrl,
      idempotencyKey: pub.idempotencyKey,
    };
  },
});

export const finishPublish = internalMutation({
  args: {
    publicationId: v.id("publications"),
    outcome: v.union(v.literal("draft_fallback"), v.literal("live"), v.literal("retryable"), v.literal("deferred"), v.literal("fatal")),
    platformPostId: v.optional(v.string()),
    error: v.optional(v.string()),
    retryAt: v.optional(v.number()),
  },
  handler: async (ctx: MutationCtx, args) => {
    const pub = await ctx.db.get("publications", args.publicationId);
    if (!pub) return null;
    if (args.outcome === "live" || args.outcome === "draft_fallback") {
      await ctx.db.patch("publications", args.publicationId, {
        status: args.outcome,
        platformPostId: args.platformPostId,
        lastError: undefined,
      });
    } else if (args.outcome === "deferred" && args.retryAt !== undefined && pub.attempts <= MAX_QUOTA_DEFERRALS) {
      // YouTube's daily quota is spent; the same approved upload waits for the next quota day.
      await ctx.db.patch("publications", args.publicationId, {
        status: "queued",
        publishAt: args.retryAt,
        lastError: `QUOTA_DEFERRED: ${args.error ?? ""}`.slice(0, 400),
      });
    } else if (args.outcome === "retryable" && pub.attempts < MAX_ATTEMPTS) {
      // backoff: 2m, 10m, 60m (contract 3)
      const delays = [2, 10, 60];
      const delayMin = delays[Math.min(pub.attempts - 1, delays.length - 1)];
      await ctx.db.patch("publications", args.publicationId, {
        status: "queued",
        publishAt: Date.now() + delayMin * 60 * 1000,
        lastError: args.error,
      });
    } else {
      await ctx.db.patch("publications", args.publicationId, { status: "failed", lastError: args.error });
    }
    return null;
  },
});

/** TikTok adapter: draft-to-inbox via FILE_UPLOAD (works pre-audit; direct
 *  post switches on when the review clears). */
export const publishOne = internalAction({
  args: { publicationId: v.id("publications") },
  handler: async (ctx: ActionCtx, args): Promise<null> => {
    const job = await ctx.runMutation(internal.publishing.markPublishing, {
      publicationId: args.publicationId,
    });
    if (!job) return null;

    const fail = async (outcome: "retryable" | "fatal", error: string) => {
      await ctx.runMutation(internal.publishing.finishPublish, {
        publicationId: args.publicationId,
        outcome,
        error: error.slice(0, 400),
      });
    };

    try {
      const account: Doc<"socialAccounts"> | null = await ctx.runQuery(
        internal.oauth.getAccountForPublish,
        { accountId: job.accountId as Id<"socialAccounts"> },
      );
      if (!account || account.status !== "connected" || !account.accessToken) {
        return await fail("fatal", "AUTH_EXPIRED: account not connected"), null;
      }
      if (!job.videoUrl) {
        return await fail("fatal", "MEDIA_REJECTED: video missing"), null;
      }

      const videoResp = await fetch(job.videoUrl);
      const video = await videoResp.arrayBuffer();

      if (account.platform === "youtube") {
        // Google access tokens expire hourly — refresh when near-dead (shared helper
        // wipes the stored tokens if Google refuses, per the retention rule).
        const fresh = await ensureGoogleAccessToken(ctx, account);
        if (fresh.token === null) {
          return await fail("fatal", `AUTH_EXPIRED: ${fresh.reason}`), null;
        }
        const accessToken = fresh.token;

        // Resumable upload. ≤3min vertical video lands as a Short automatically.
        // Unverified-OAuth apps get uploads locked to private — expected pre-launch.
        const title = (job.title || job.caption || "Man Friday post").slice(0, 95);
        const initResp = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "X-Upload-Content-Type": "video/mp4",
              "X-Upload-Content-Length": String(video.byteLength),
            },
            body: JSON.stringify({
              snippet: { title, description: job.caption, categoryId: "22" },
              status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
            }),
          },
        );
        if (!initResp.ok) {
          const text = (await initResp.text()).slice(0, 300);
          if (initResp.status === 401) {
            await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
            return await fail("fatal", `AUTH_EXPIRED: ${text}`), null;
          }
          if (initResp.status === 403 && /quota/i.test(text)) {
            // The day's quota is spent (refills at midnight Pacific): wait for the next quota day.
            await ctx.runMutation(internal.publishing.finishPublish, {
              publicationId: args.publicationId,
              outcome: "deferred",
              retryAt: nextQuotaDayStart(Date.now()),
              error: text.slice(0, 200),
            });
            return null;
          }
          await ctx.runMutation(internal.stats.countUnits, { units: UPLOAD_UNITS });
          return await fail(initResp.status >= 500 ? "retryable" : "fatal", `${initResp.status}: ${text}`), null;
        }
        // The insert is accepted at init: the 1,600 units are spent whether or not the PUT completes.
        await ctx.runMutation(internal.stats.countUnits, { units: UPLOAD_UNITS });
        const uploadUrl = initResp.headers.get("Location");
        if (!uploadUrl) {
          return await fail("retryable", "TRANSIENT: no resumable upload URL"), null;
        }
        const putResp = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "video/mp4", "Content-Length": String(video.byteLength) },
          body: video,
        });
        if (!putResp.ok) {
          return await fail("retryable", `TRANSIENT: upload ${putResp.status}`), null;
        }
        const uploaded = (await putResp.json()) as { id?: string };
        await ctx.runMutation(internal.publishing.finishPublish, {
          publicationId: args.publicationId,
          outcome: "live",
          platformPostId: uploaded.id,
        });
        return null;
      }

      // TikTok access tokens live 24h; refresh tokens rotate on every refresh.
      let tiktokToken = account.accessToken;
      if (account.expiresAt < Date.now() + 60_000) {
        if (!account.refreshToken) {
          await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
          return await fail("fatal", "AUTH_EXPIRED: no refresh token"), null;
        }
        const rBody = new URLSearchParams({
          client_key: env.TIKTOK_CLIENT_KEY ?? "",
          client_secret: env.TIKTOK_CLIENT_SECRET ?? "",
          grant_type: "refresh_token",
          refresh_token: account.refreshToken,
        });
        const rResp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: rBody.toString(),
        });
        const r = (await rResp.json()) as {
          access_token?: string;
          expires_in?: number;
          refresh_token?: string;
          error?: string;
          error_description?: string;
        };
        if (!rResp.ok || !r.access_token) {
          await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
          return await fail("fatal", `AUTH_EXPIRED: tiktok refresh failed (${r.error_description ?? r.error ?? rResp.status})`), null;
        }
        tiktokToken = r.access_token;
        await ctx.runMutation(internal.oauth.updateTokens, {
          accountId: account._id,
          accessToken: tiktokToken,
          expiresAt: Date.now() + (r.expires_in ?? 86400) * 1000,
          refreshToken: r.refresh_token,
        });
      }

      // inbox (draft) upload init
      const initResp = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tiktokToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_info: {
            source: "FILE_UPLOAD",
            video_size: video.byteLength,
            chunk_size: video.byteLength,
            total_chunk_count: 1,
          },
        }),
      });
      const init = (await initResp.json()) as {
        data?: { publish_id?: string; upload_url?: string };
        error?: { code?: string; message?: string };
      };
      if (!initResp.ok || !init.data?.upload_url) {
        const code = init.error?.code ?? String(initResp.status);
        const msg = `${code}: ${init.error?.message ?? "init failed"}`;
        const retryable = initResp.status >= 500 || code === "rate_limit_exceeded";
        return await fail(retryable ? "retryable" : "fatal", msg), null;
      }

      const putResp = await fetch(init.data.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes 0-${video.byteLength - 1}/${video.byteLength}`,
        },
        body: video,
      });
      if (!putResp.ok) {
        return await fail("retryable", `TRANSIENT: upload ${putResp.status}`), null;
      }

      await ctx.runMutation(internal.publishing.finishPublish, {
        publicationId: args.publicationId,
        outcome: "draft_fallback",
        platformPostId: init.data.publish_id,
      });
      return null;
    } catch (err) {
      await fail("retryable", `TRANSIENT: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },
});

export const publishDue = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const due: Id<"publications">[] = await ctx.runQuery(internal.publishing.duePublications, {
      now: Date.now(),
    });
    for (const publicationId of due) {
      await ctx.scheduler.runAfter(0, internal.publishing.publishOne, { publicationId });
    }
    return due.length;
  },
});
