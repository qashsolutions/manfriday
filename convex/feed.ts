import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentUserId } from "./users";

/** The Picks feed: the signed-in user's swipeable concepts, newest batch first. */
export const myFeed = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return { concepts: [], kept: 0, pending: 0 };

    const rows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "preview_ready"))
      .order("desc")
      .take(30);
    const keptRows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "kept"))
      .take(100);
    const renderedRows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "rendered"))
      .take(100);
    // Drafts whose preview is still rendering — the screen says so instead of "empty".
    const draftRows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "draft"))
      .take(100);

    const concepts = [];
    for (const c of rows) {
      const template = await ctx.db.get("trendTemplates", c.templateId);
      concepts.push({
        id: c._id,
        slots: c.slots,
        language: c.language,
        languageStyle: c.languageStyle ?? null,
        variantOf: c.variantOf ?? null,
        format: template?.format ?? "slideshow",
        hookPattern: template?.hookPattern ?? "",
        refViews: template?.refStats.views ?? 0,
        refPlatform: template?.refStats.platform ?? "tiktok",
        thumbUrl: c.previewThumbId ? await ctx.storage.getUrl(c.previewThumbId) : null,
      });
    }
    return { concepts, kept: keptRows.length + renderedRows.length, pending: draftRows.length };
  },
});

/** The signed-in user's finished videos (right-swiped and fully rendered). */
export const myRendered = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "rendered"))
      .order("desc")
      .take(20);
    // A rendered concept that already has a post is in the queue, not "ready to schedule".
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(200);
    const scheduled = new Set(posts.map((p) => p.conceptId));
    const out = [];
    for (const c of rows) {
      if (scheduled.has(c._id)) continue;
      const template = await ctx.db.get("trendTemplates", c.templateId);
      out.push({
        id: c._id,
        slots: c.slots,
        format: template?.format ?? "slideshow",
        videoUrl: c.videoId ? await ctx.storage.getUrl(c.videoId) : null,
        thumbUrl: c.previewThumbId ? await ctx.storage.getUrl(c.previewThumbId) : null,
      });
    }
    return out;
  },
});

/** The swipe. Right = keep (queues the full-quality lazy render). Left = skip. */
export const swipe = mutation({
  args: { conceptId: v.id("concepts"), keep: v.boolean() },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const concept = await ctx.db.get("concepts", args.conceptId);
    if (!concept || concept.userId !== userId) throw new Error("not your concept");
    if (concept.status !== "preview_ready") return null;

    if (args.keep) {
      await ctx.db.patch("concepts", args.conceptId, { status: "render_queued", swipedAt: Date.now() });
      await ctx.db.insert("renderJobs", {
        conceptId: args.conceptId,
        kind: "final",
        status: "pending",
        priority: 20, // finals beat previews (the lazy-render moment)
        attempts: 0,
      });
    } else {
      await ctx.db.patch("concepts", args.conceptId, { status: "skipped", swipedAt: Date.now() });
    }
    return null;
  },
});

const LANGUAGE_CODES = ["en", "es", "pt-BR", "id", "hi", "bn", "ta", "te", "mr", "kn", "ml", "gu", "pa", "or"];

/** Language UX §2: "also in" — one tap after a keep asks the worker to
 *  re-slot-fill the same concept in another market's language. Each variant
 *  is a video against the allowance (metered on the concept row like any other). */
export const requestVariant = mutation({
  args: {
    conceptId: v.id("concepts"),
    language: v.string(),
    languageStyle: v.optional(v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"))),
  },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const concept = await ctx.db.get("concepts", args.conceptId);
    if (!concept || concept.userId !== userId) throw new Error("not your concept");
    if (!["render_queued", "kept", "rendered"].includes(concept.status)) throw new Error("keep the pick first");
    if (!LANGUAGE_CODES.includes(args.language)) throw new Error("unsupported language");
    if (args.language === concept.language) throw new Error("already in that language");
    const brand = await ctx.db.get("brands", concept.brandId);
    await ctx.db.insert("pipelineRequests", {
      userId,
      url: brand?.url ?? "",
      kind: "variant",
      conceptId: args.conceptId,
      language: args.language,
      languageStyle: args.languageStyle,
      status: "pending",
      brandId: concept.brandId,
    });
    return null;
  },
});

/** Discard a rendered video from "ready to schedule": the desktop equivalent of a
 *  left-swipe. Marks the concept skipped and deletes its files. Only allowed
 *  while nothing has been scheduled from it (scheduled posts live in the queue). */
export const discard = mutation({
  args: { conceptId: v.id("concepts") },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const c = await ctx.db.get("concepts", args.conceptId);
    if (!c || c.userId !== userId) throw new Error("not your concept");
    if (c.status !== "rendered") throw new Error("only rendered videos can be discarded here");
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(200);
    if (posts.some((p) => p.conceptId === c._id)) throw new Error("this video is already scheduled");
    if (c.videoId) await ctx.storage.delete(c.videoId);
    if (c.previewThumbId) await ctx.storage.delete(c.previewThumbId);
    await ctx.db.patch("concepts", args.conceptId, { status: "skipped", videoId: undefined, previewThumbId: undefined, swipedAt: Date.now() });
    return null;
  },
});
