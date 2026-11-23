import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { currentUserId } from "./users";

const LANGUAGE_CODES = ["en", "es", "pt-BR", "id", "hi", "bn", "ta", "te", "mr", "kn", "ml", "gu", "pa", "or"];
const languageStyle = v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"));

/** The signed-in user's brand (one workspace in v1). */
export const myBrand = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    if (!brand) return null;
    return {
      id: brand._id,
      name: brand.name,
      language: brand.language,
      languageStyle: brand.languageStyle ?? null,
      markets: brand.markets ?? null,
      status: brand.status,
      presenterUrl: brand.presenterImageId ? await ctx.storage.getUrl(brand.presenterImageId) : null,
      hasPresenter: !!brand.presenterImageId,
      voice: brand.voice ?? "female",
    };
  },
});

/** The brief Friday works from, as the user can see and correct it. */
export const myBrief = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    if (!brand) return null;
    return {
      id: brand._id,
      url: brand.url,
      name: brand.name,
      oneLiner: brand.oneLiner,
      audience: brand.audience,
      tone: brand.tone,
      niche: brand.niche,
      facts: brand.facts ?? [],
      trendNiche: brand.trendNiche ?? null,
    };
  },
});

/** Trend-library niches and how many trends each has — what a brand can draw from. */
export const libraryNiches = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const rows = await ctx.db
      .query("trendTemplates")
      .withIndex("by_active_and_engagementScore", (q) => q.eq("active", true))
      .take(2000);
    const counts = new Map<string, number>();
    for (const t of rows) for (const n of t.niches) counts.set(n, (counts.get(n) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([slug, count]) => ({ slug, count }));
  },
});

const line = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const lines = (xs: string[], max: number, count: number) => xs.map((x) => line(x, max)).filter(Boolean).slice(0, count);

/** The user corrects Friday's brief. Future picks use it (briefVersion bumps);
 *  videos already made keep the words they have. */
export const updateBrief = mutation({
  args: {
    brandId: v.id("brands"),
    name: v.string(),
    oneLiner: v.string(),
    audience: v.array(v.string()),
    tone: v.array(v.string()),
    facts: v.array(v.string()),
    trendNiche: v.union(v.string(), v.null()),
  },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not your brand");
    const name = line(args.name, 60);
    const oneLiner = line(args.oneLiner, 200);
    if (!name || !oneLiner) throw new Error("The name and the one-line description can't be empty.");
    const audience = lines(args.audience, 80, 6);
    if (audience.length === 0) throw new Error("Say who it's for — at least one audience.");
    let trendNiche: string | undefined;
    if (args.trendNiche !== null) {
      trendNiche = args.trendNiche;
      if (trendNiche !== "none") {
        const known = await ctx.db
          .query("trendTemplates")
          .withIndex("by_active_and_engagementScore", (q) => q.eq("active", true))
          .take(2000);
        if (!known.some((t) => t.niches.includes(trendNiche!))) throw new Error("unknown trend space");
      }
    }
    await ctx.db.patch("brands", args.brandId, {
      name,
      oneLiner,
      audience,
      tone: lines(args.tone, 30, 4),
      facts: lines(args.facts, 160, 12),
      trendNiche,
      briefVersion: brand.briefVersion + 1,
    });
    return null;
  },
});

/** Language UX §1: the chip/combobox and "how it sounds" write here. Bumps
 *  briefVersion so future concepts pin the new language; existing ones keep theirs. */
export const setLanguage = mutation({
  args: {
    brandId: v.id("brands"),
    language: v.string(),
    languageStyle: v.optional(languageStyle),
  },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not your brand");
    if (!LANGUAGE_CODES.includes(args.language)) throw new Error("unsupported language");
    const changed = brand.language !== args.language || (brand.languageStyle ?? null) !== (args.languageStyle ?? null);
    await ctx.db.patch("brands", args.brandId, {
      language: args.language,
      languageStyle: args.languageStyle,
      briefVersion: changed ? brand.briefVersion + 1 : brand.briefVersion,
    });
    return null;
  },
});

/** Presenter photo upload, step 1: a short-lived storage upload URL. */
export const presenterUploadUrl = mutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 2: attach the uploaded photo to the brand. `consent` must be true —
 *  the UI shows the attestation text; we record when it was given. The old
 *  photo file is deleted so only one presenter ever exists per brand. */
export const setPresenter = mutation({
  args: { brandId: v.id("brands"), storageId: v.id("_storage"), consent: v.literal(true) },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not your brand");
    if (brand.presenterImageId && brand.presenterImageId !== args.storageId) {
      await ctx.storage.delete(brand.presenterImageId);
    }
    await ctx.db.patch("brands", args.brandId, { presenterImageId: args.storageId, presenterConsentAt: Date.now() });
    return null;
  },
});

/** Remove the presenter: deletes the file; future avatar concepts stop being
 *  generated until a new photo is added. Rendered videos are unaffected. */
export const removePresenter = mutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not your brand");
    if (brand.presenterImageId) await ctx.storage.delete(brand.presenterImageId);
    await ctx.db.patch("brands", args.brandId, { presenterImageId: undefined, presenterConsentAt: undefined });
    return null;
  },
});

/** "Use my profile photo": copy the Clerk avatar into storage server-side (the
 *  browser can't fetch img.clerk.com cross-origin) and attach it as the presenter.
 *  Only Clerk-hosted URLs are accepted, so this can't be used to fetch arbitrary hosts. */
export const usePresenterFromProfile = action({
  args: { brandId: v.id("brands"), imageUrl: v.string(), consent: v.literal(true) },
  handler: async (ctx: ActionCtx, args): Promise<null> => {
    const mine = await ctx.runQuery(api.brands.myBrand, {});
    if (!mine || mine.id !== args.brandId) throw new Error("not your brand");
    const u = new URL(args.imageUrl);
    if (u.protocol !== "https:" || !/(^|\.)clerk\.com$/.test(u.hostname)) throw new Error("not a profile photo URL");
    const resp = await fetch(args.imageUrl);
    if (!resp.ok) throw new Error(`profile photo fetch failed (${resp.status})`);
    const blob = await resp.blob();
    if (blob.size > 10 * 1024 * 1024) throw new Error("photo too large");
    const storageId: Id<"_storage"> = await ctx.storage.store(blob);
    await ctx.runMutation(internal.brands.attachPresenter, { brandId: args.brandId, storageId });
    return null;
  },
});

export const attachPresenter = internalMutation({
  args: { brandId: v.id("brands"), storageId: v.id("_storage") },
  handler: async (ctx: MutationCtx, args) => {
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand) throw new Error("no brand");
    if (brand.presenterImageId && brand.presenterImageId !== args.storageId) await ctx.storage.delete(brand.presenterImageId);
    await ctx.db.patch("brands", args.brandId, { presenterImageId: args.storageId, presenterConsentAt: Date.now() });
    return null;
  },
});

/** Presenter voice (female/male) — applies to every video the brand renders from now on. */
export const setVoice = mutation({
  args: { brandId: v.id("brands"), voice: v.union(v.literal("female"), v.literal("male")) },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not your brand");
    await ctx.db.patch("brands", args.brandId, { voice: args.voice });
    return null;
  },
});
