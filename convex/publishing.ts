import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { currentUserId } from "./users";

// Contract 3 spine: posts → publications; a minute-cron scans by_due and runs
// the platform adapter. v1 adapter = TikTok draft-to-inbox (FILE_UPLOAD), the
// pre-audit path; direct post + YouTube land as the approvals clear.

const MAX_ATTEMPTS = 3;

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

    const caption: string = (concept.slots as Record<string, string>).caption ?? "";
    const postId = await ctx.db.insert("posts", {
      userId,
      conceptId: args.conceptId,
      publishAt: args.publishAt,
      captionByPlatform: { tiktok: caption, youtube: caption },
    });
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
      out.push({
        id: post._id,
        publishAt: post.publishAt,
        hook:
          ((concept?.slots as Record<string, string>) ?? {}).hook ??
          ((concept?.slots as Record<string, string>) ?? {}).hook_text ??
          "",
        publications: pubs.map((p) => ({
          id: p._id,
          platform: p.platform,
          status: p.status,
          error: p.lastError ?? null,
        })),
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
    outcome: v.union(v.literal("draft_fallback"), v.literal("live"), v.literal("retryable"), v.literal("fatal")),
    platformPostId: v.optional(v.string()),
    error: v.optional(v.string()),
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
        // Google access tokens expire hourly — refresh when near-dead.
        let accessToken = account.accessToken;
        if (account.expiresAt < Date.now() + 60_000) {
          if (!account.refreshToken) {
            await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
            return await fail("fatal", "AUTH_EXPIRED: no refresh token"), null;
          }
          const rBody = new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID ?? "",
            client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
            refresh_token: account.refreshToken,
            grant_type: "refresh_token",
          });
          const rResp = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: rBody.toString(),
          });
          const r = (await rResp.json()) as { access_token?: string; expires_in?: number; error?: string };
          if (!rResp.ok || !r.access_token) {
            await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
            return await fail("fatal", `AUTH_EXPIRED: refresh failed (${r.error ?? rResp.status})`), null;
          }
          accessToken = r.access_token;
          await ctx.runMutation(internal.oauth.updateTokens, {
            accountId: account._id,
            accessToken,
            expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
          });
        }

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
          if (initResp.status === 403) {
            // daily quota exhausts and refills at midnight PT — retry later
            return await fail("retryable", `QUOTA_EXCEEDED: ${text}`), null;
          }
          return await fail(initResp.status >= 500 ? "retryable" : "fatal", `${initResp.status}: ${text}`), null;
        }
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

      // inbox (draft) upload init
      const initResp = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
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
