import { v } from "convex/values";
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
        ? { name: brand.name, url: brand.url, niche: brand.niche, language: brand.language, screenshotIds: brand.screenshotIds }
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
      await ctx.db.patch("concepts", job.conceptId, { status: "failed" });
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
