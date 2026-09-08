import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentUserId } from "./users";

/** "Friday's first day" — submit a product URL; the worker does the rest. */
export const submitUrl = mutation({
  args: { url: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    let url: string;
    try {
      const parsed = new URL(args.url.includes("://") ? args.url : `https://${args.url}`);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
      url = parsed.toString();
    } catch {
      throw new Error("That doesn't look like a URL — try yourproduct.com");
    }
    return await ctx.db.insert("pipelineRequests", {
      userId,
      url,
      status: "pending",
    });
  },
});

/** Live status of the user's latest request (drives the onboarding screen). */
export const myLatestRequest = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const reqs = await ctx.db
      .query("pipelineRequests")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1);
    const req = reqs[0];
    if (!req) return null;
    const brand = req.brandId ? await ctx.db.get("brands", req.brandId) : null;
    return {
      id: req._id,
      url: req.url,
      status: req.status,
      error: req.error ?? null,
      brand: brand
        ? { name: brand.name, oneLiner: brand.oneLiner, niche: brand.niche, language: brand.language, tone: brand.tone }
        : null,
    };
  },
});
