import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { env } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Generation-pipeline API for the worker/CLI (token-guarded like worker.ts).
// M1 runs the pipeline headless from the worker; M2 moves brief creation into
// user-facing actions with Clerk auth.

function requireWorker(token: string) {
  const expected = env.WORKER_TOKEN;
  if (!expected || token !== expected) throw new Error("pipeline: invalid token");
}

/** Dev/M1: ensure a pipeline user exists (Clerk users arrive in M2). */
export const ensureDevUser = mutation({
  args: { token: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", "m1_pipeline_user"))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", {
      clerkId: "m1_pipeline_user",
      email: "pipeline@manfriday.app",
      plan: "free",
      credits: 0,
      videosUsedThisPeriod: 0,
      timezone: "America/Los_Angeles",
    });
  },
});

export const upsertBrand = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    url: v.string(),
    name: v.string(),
    oneLiner: v.string(),
    audience: v.array(v.string()),
    tone: v.array(v.string()),
    niche: v.string(),
    language: v.string(),
    screenshotIds: v.array(v.id("_storage")),
  },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const existing = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("url"), args.url))
      .first();
    const fields = {
      name: args.name,
      oneLiner: args.oneLiner,
      audience: args.audience,
      tone: args.tone,
      niche: args.niche,
      language: args.language,
      screenshotIds: args.screenshotIds,
      status: "ready" as const,
    };
    if (existing) {
      await ctx.db.patch("brands", existing._id, {
        ...fields,
        briefVersion: existing.briefVersion + 1,
      });
      return { brandId: existing._id, briefVersion: existing.briefVersion + 1 };
    }
    const brandId = await ctx.db.insert("brands", {
      userId: args.userId,
      url: args.url,
      ...fields,
      briefVersion: 1,
    });
    return { brandId, briefVersion: 1 };
  },
});

export const upsertTemplate = mutation({
  args: {
    token: v.string(),
    slug: v.string(),
    format: v.union(v.literal("slideshow"), v.literal("hook_video"), v.literal("avatar")),
    niches: v.array(v.string()),
    hookPattern: v.string(),
    refUrl: v.string(),
    refStats: v.object({ platform: v.string(), views: v.number(), capturedAt: v.number() }),
    structure: v.any(),
    specVersion: v.number(),
    engagementScore: v.number(),
  },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const { token: _token, ...fields } = args;
    const existing = await ctx.db
      .query("trendTemplates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (existing) {
      await ctx.db.patch("trendTemplates", existing._id, { ...fields, active: true });
      return existing._id;
    }
    return await ctx.db.insert("trendTemplates", { ...fields, active: true });
  },
});

export const listActiveTemplates = query({
  args: { token: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    requireWorker(args.token);
    const rows = await ctx.db
      .query("trendTemplates")
      .withIndex("by_active_and_engagementScore", (q) => q.eq("active", true))
      .order("desc")
      .take(100);
    return rows.map((t) => ({
      id: t._id,
      slug: t.slug,
      format: t.format,
      niches: t.niches,
      hookPattern: t.hookPattern,
      refStats: t.refStats,
      structure: t.structure,
      specVersion: t.specVersion,
      engagementScore: t.engagementScore,
    }));
  },
});

export const createConcepts = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    brandId: v.id("brands"),
    briefVersion: v.number(),
    language: v.string(),
    languageStyle: v.optional(v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"))),
    batchId: v.string(),
    concepts: v.array(
      v.object({
        templateId: v.id("trendTemplates"),
        specVersion: v.number(),
        slots: v.any(),
        kind: v.union(v.literal("preview"), v.literal("final")),
        priority: v.number(),
        llmCostCents: v.optional(v.number()),
        variantOf: v.optional(v.id("concepts")),
      }),
    ),
  },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const created: Array<{ conceptId: Id<"concepts">; jobId: Id<"renderJobs"> }> = [];
    for (const c of args.concepts) {
      const conceptId = await ctx.db.insert("concepts", {
        userId: args.userId,
        brandId: args.brandId,
        templateId: c.templateId,
        briefVersion: args.briefVersion,
        specVersion: c.specVersion,
        language: args.language,
        languageStyle: args.languageStyle,
        variantOf: c.variantOf,
        // a variant of a kept concept goes straight to its final render
        status: c.variantOf ? "render_queued" : "draft",
        slots: c.slots,
        batchId: args.batchId,
        costCents: c.llmCostCents ?? 0,
        swipedAt: c.variantOf ? Date.now() : undefined,
      });
      const jobId = await ctx.db.insert("renderJobs", {
        conceptId,
        kind: c.kind,
        status: "pending",
        priority: c.priority,
        attempts: 0,
      });
      created.push({ conceptId, jobId });
    }
    return created;
  },
});

/** Queue full-quality renders for already-generated concepts (the
 *  right-swipe moment in the app; the CLI's `finals` command in M1). */
export const queueFinals = mutation({
  args: { token: v.string(), conceptIds: v.array(v.id("concepts")) },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const jobs: Id<"renderJobs">[] = [];
    for (const conceptId of args.conceptIds) {
      const concept = await ctx.db.get("concepts", conceptId);
      if (!concept) continue;
      await ctx.db.patch("concepts", conceptId, { status: "render_queued" });
      jobs.push(
        await ctx.db.insert("renderJobs", {
          conceptId,
          kind: "final",
          status: "pending",
          priority: 20,
          attempts: 0,
        }),
      );
    }
    return jobs;
  },
});

/** Signed URL for a stored file (worker downloads brand screenshots etc.). */
export const storageUrl = query({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx: QueryCtx, args) => {
    requireWorker(args.token);
    return await ctx.storage.getUrl(args.storageId);
  },
});

/** Batch status for the CLI to poll. */
export const batchStatus = query({
  args: { token: v.string(), userId: v.id("users"), batchId: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    requireWorker(args.token);
    const rows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", args.userId))
      .take(500);
    const batch = rows.filter((c) => c.batchId === args.batchId);
    return batch.map((c) => ({
      conceptId: c._id,
      status: c.status,
      videoId: c.videoId ?? null,
      previewThumbId: c.previewThumbId ?? null,
      costCents: c.costCents,
    }));
  },
});

/** Everything the worker needs to re-slot-fill one kept concept in another
 *  language (docs/language-ux.md §2): the brief, the template, the original slots. */
export const variantContext = query({
  args: { token: v.string(), conceptId: v.id("concepts") },
  handler: async (ctx: QueryCtx, args) => {
    requireWorker(args.token);
    const concept = await ctx.db.get("concepts", args.conceptId);
    if (!concept) return null;
    const brand = await ctx.db.get("brands", concept.brandId);
    const template = await ctx.db.get("trendTemplates", concept.templateId);
    if (!brand || !template) return null;
    return {
      userId: concept.userId,
      brandId: brand._id,
      briefVersion: brand.briefVersion,
      brief: {
        name: brand.name,
        one_liner: brand.oneLiner,
        audience: brand.audience,
        tone: brand.tone,
        niche: brand.niche,
        language: brand.language,
      },
      template: {
        id: template._id,
        slug: template.slug,
        format: template.format,
        hookPattern: template.hookPattern,
        structure: template.structure,
        specVersion: template.specVersion,
      },
      sourceSlots: concept.slots,
      sourceLanguage: concept.language,
    };
  },
});

/** Worker: does this brand have a presenter photo? Avatar templates are only
 *  planned when it does (D2 amended 14 Sep 2026). */
export const brandHasPresenter = query({
  args: { token: v.string(), brandId: v.id("brands") },
  handler: async (ctx: QueryCtx, args) => {
    requireWorker(args.token);
    const brand = await ctx.db.get("brands", args.brandId);
    return !!brand?.presenterImageId;
  },
});
