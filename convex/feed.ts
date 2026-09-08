import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentUserId } from "./users";

/** The Picks feed: the signed-in user's swipeable concepts, newest batch first. */
export const myFeed = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return { concepts: [], kept: 0 };

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

    const concepts = [];
    for (const c of rows) {
      const template = await ctx.db.get("trendTemplates", c.templateId);
      concepts.push({
        id: c._id,
        slots: c.slots,
        language: c.language,
        format: template?.format ?? "slideshow",
        hookPattern: template?.hookPattern ?? "",
        refViews: template?.refStats.views ?? 0,
        refPlatform: template?.refStats.platform ?? "tiktok",
        thumbUrl: c.previewThumbId ? await ctx.storage.getUrl(c.previewThumbId) : null,
      });
    }
    return { concepts, kept: keptRows.length + renderedRows.length };
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
    const out = [];
    for (const c of rows) {
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
