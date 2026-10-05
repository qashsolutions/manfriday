import { v } from "convex/values";
import { refundVideo } from "./allowance";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { env } from "./_generated/server";

// The render worker's API (Friday Internals contract 1: the queue lives in the
// DB; the Python worker long-polls it). These are public functions because the
// worker is an external client — every call is guarded by WORKER_TOKEN.

function requireWorker(token: string) {
  const expected = env.WORKER_TOKEN;
  if (!expected || token !== expected) {
    throw new Error("worker: invalid token");
  }
}

const MAX_ATTEMPTS = 3;

/** Claim the highest-priority pending job. Atomic: read + mark in one mutation. */
export const claimJob = mutation({
  args: { token: v.string(), workerId: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const job = await ctx.db
      .query("renderJobs")
      .withIndex("by_status_and_priority", (q) => q.eq("status", "pending"))
      .order("desc") // highest priority first
      .first();
    if (!job) return null;

    await ctx.db.patch("renderJobs", job._id, {
      status: "claimed",
      claimedBy: args.workerId,
      claimedAt: Date.now(),
      attempts: job.attempts + 1,
    });

    const concept = await ctx.db.get("concepts", job.conceptId);
    if (!concept) {
      await ctx.db.patch("renderJobs", job._id, { status: "failed", error: "concept missing" });
      return null;
    }
    const template = await ctx.db.get("trendTemplates", concept.templateId);
    const brand = await ctx.db.get("brands", concept.brandId);

    return {
      jobId: job._id,
      kind: job.kind,
      concept: {
        id: concept._id,
        language: concept.language,
        slots: concept.slots,
        specVersion: concept.specVersion,
      },
      template: template ? { slug: template.slug, format: template.format, structure: template.structure } : null,
      brand: brand
        ? {
            name: brand.name,
            url: brand.url,
            niche: brand.niche,
            language: brand.language,
            screenshotIds: brand.screenshotIds,
            presenterImageId: brand.presenterImageId ?? null,
            voice: brand.voice ?? "female",
          }
        : null,
    };
  },
});

/** Keep-alive; the stale-claim reaper (cron, M1.5) uses claimedAt. */
export const heartbeat = mutation({
  args: { token: v.string(), jobId: v.id("renderJobs") },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    await ctx.db.patch("renderJobs", args.jobId, { status: "running", claimedAt: Date.now() });
    return null;
  },
});

/** Mint a storage upload URL for the rendered artifact. */
export const uploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    return await ctx.storage.generateUploadUrl();
  },
});

export const completeJob = mutation({
  args: {
    token: v.string(),
    jobId: v.id("renderJobs"),
    videoId: v.optional(v.id("_storage")),
    previewThumbId: v.optional(v.id("_storage")),
    costCents: v.number(),
  },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const job = await ctx.db.get("renderJobs", args.jobId);
    if (!job) throw new Error("job missing");

    await ctx.db.patch("renderJobs", args.jobId, { status: "done", error: undefined });

    const concept = await ctx.db.get("concepts", job.conceptId);
    if (concept) {
      // First previews of a batch are the moment the product becomes real: tell them.
      if (job.kind === "preview") {
        const batch = await ctx.db
          .query("concepts")
          .withIndex("by_userId_and_status", (q) => q.eq("userId", concept.userId))
          .take(500);
        const mine = batch.filter((c) => c.batchId === concept.batchId);
        const ready = mine.filter((c) => c.status === "preview_ready").length + 1;
        if (ready >= 3) {
          const reqs = await ctx.db
            .query("pipelineRequests")
            .withIndex("by_userId", (q) => q.eq("userId", concept.userId))
            .take(50);
          const req = reqs.find((r) => r.batchId === concept.batchId && !r.previewsEmailedAt);
          if (req) await ctx.scheduler.runAfter(0, internal.email.previewsReady, { requestId: req._id, ready });
        }
      }
      await ctx.db.patch("concepts", job.conceptId, {
        status: job.kind === "final" ? "rendered" : "preview_ready",
        ...(args.videoId ? { videoId: args.videoId } : {}),
        ...(args.previewThumbId ? { previewThumbId: args.previewThumbId } : {}),
        costCents: concept.costCents + args.costCents,
      });
    }
    return null;
  },
});

export const failJob = mutation({
  args: { token: v.string(), jobId: v.id("renderJobs"), error: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const job = await ctx.db.get("renderJobs", args.jobId);
    if (!job) throw new Error("job missing");

    if (job.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch("renderJobs", args.jobId, { status: "failed", error: args.error });
      const concept = await ctx.db.get("concepts", job.conceptId);
      await ctx.db.patch("concepts", job.conceptId, { status: "failed", billedFrom: undefined, billedPeriodStartsAt: undefined });
      // A video that never rendered doesn't count against the allowance.
      if (concept && job.kind === "final") await refundVideo(ctx, concept.userId, concept.billedFrom, concept.billedPeriodStartsAt);
      if (concept) {
        if (job.kind === "final") {
          const slots = (concept.slots ?? {}) as Record<string, string>;
          await ctx.scheduler.runAfter(0, internal.email.renderFailed, {
            userId: concept.userId,
            hook: (slots.hook ?? slots.hook_text ?? slots.hook_overlay ?? "").slice(0, 80),
          });
        }
        await ctx.scheduler.runAfter(0, internal.alerts.raise, {
          kind: "render_failed",
          message: `${job.kind} render gave up after ${job.attempts} attempts: ${args.error}`.slice(0, 900),
          userId: concept.userId,
          refId: job.conceptId,
        });
      }
    } else {
      // back to the queue for another worker/attempt
      await ctx.db.patch("renderJobs", args.jobId, {
        status: "pending",
        error: args.error,
        claimedBy: undefined,
        claimedAt: undefined,
      });
    }
    return null;
  },
});

// ── pipeline requests (M2 onboarding → worker) ─────────────────────────────

export const claimPipelineRequest = mutation({
  args: { token: v.string(), workerId: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const req = await ctx.db
      .query("pipelineRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .first();
    if (!req) return null;
    await ctx.db.patch("pipelineRequests", req._id, {
      status: "claimed",
      claimedBy: args.workerId,
      claimedAt: Date.now(),
    });
    return {
      requestId: req._id,
      userId: req.userId,
      url: req.url,
      kind: req.kind ?? "generate",
      conceptId: req.conceptId ?? null,
      language: req.language ?? null,
      languageStyle: req.languageStyle ?? null,
    };
  },
});

export const updatePipelineRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("pipelineRequests"),
    status: v.union(v.literal("analyzing"), v.literal("drafting")),
    brandId: v.optional(v.id("brands")),
  },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    await ctx.db.patch("pipelineRequests", args.requestId, {
      status: args.status,
      ...(args.brandId ? { brandId: args.brandId } : {}),
    });
    return null;
  },
});

export const completePipelineRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("pipelineRequests"),
    brandId: v.id("brands"),
    batchId: v.string(),
  },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const req = await ctx.db.get("pipelineRequests", args.requestId);
    await ctx.db.patch("pipelineRequests", args.requestId, {
      status: "done",
      brandId: args.brandId,
      batchId: args.batchId,
    });
    // An "also in" variant was charged at request time; the charge now lives on
    // the concept it produced, so a failed final render can give it back.
    if (req?.kind === "variant" && req.billedFrom) {
      const rows = await ctx.db
        .query("concepts")
        .withIndex("by_userId_and_status", (q) => q.eq("userId", req.userId))
        .take(500);
      const made = rows.find((c) => c.batchId === args.batchId && c.variantOf);
      if (made) {
        await ctx.db.patch("concepts", made._id, { billedFrom: req.billedFrom, billedPeriodStartsAt: req.billedPeriodStartsAt });
        await ctx.db.patch("pipelineRequests", args.requestId, { billedFrom: undefined, billedPeriodStartsAt: undefined });
      }
    }
    return null;
  },
});

export const failPipelineRequest = mutation({
  args: { token: v.string(), requestId: v.id("pipelineRequests"), error: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    requireWorker(args.token);
    const req = await ctx.db.get("pipelineRequests", args.requestId);
    await ctx.db.patch("pipelineRequests", args.requestId, { status: "failed", error: args.error, billedFrom: undefined, billedPeriodStartsAt: undefined });
    if (req) {
      await refundVideo(ctx, req.userId, req.billedFrom, req.billedPeriodStartsAt);
      await ctx.scheduler.runAfter(0, internal.alerts.raise, {
        kind: "brief_failed",
        message: `${req.kind ?? "generate"} request failed for ${req.url}: ${args.error}`.slice(0, 900),
        userId: req.userId,
        refId: args.requestId,
      });
    }
    return null;
  },
});
