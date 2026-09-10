import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

// Dev-only seeder: creates one user/brand/template/concept and a pending
// preview render job so the worker loop can be exercised end to end.
// Run: npx convex run dev:seedTestJob
export const seedTestJob = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "dev_seed_user",
      email: "dev@manfriday.app",
      plan: "free",
      credits: 0,
      videosUsedThisPeriod: 0,
      avatarVideosUsedThisPeriod: 0,
      timezone: "America/Los_Angeles",
    });
    const brandId = await ctx.db.insert("brands", {
      userId,
      url: "https://manfriday.app",
      name: "Man Friday",
      oneLiner: "You build. Friday posts.",
      audience: ["solo builders", "indie hackers"],
      tone: ["direct", "casual"],
      niche: "build-in-public",
      language: "en",
      screenshotIds: [],
      status: "ready",
      briefVersion: 1,
    });
    const templateId = await ctx.db.insert("trendTemplates", {
      slug: "confession-turnaround-slideshow",
      format: "slideshow",
      niches: ["build-in-public", "productivity-tools"],
      hookPattern: "confession-turn",
      refUrl: "https://example.invalid/trend-ref",
      refStats: { platform: "tiktok", views: 2_900_000, capturedAt: Date.now() },
      structure: { specVersion: 1, kind: "dev-stub" }, // real templateSpec lands with the library seeder
      specVersion: 1,
      engagementScore: 90,
      active: true,
    });
    const conceptId = await ctx.db.insert("concepts", {
      userId,
      brandId,
      templateId,
      briefVersion: 1,
      specVersion: 1,
      language: "en",
      status: "draft",
      slots: {
        hook: "I posted every day for 6 months and gained 41 followers. then I changed one thing",
        cta: "the job's taken — manfriday.app",
      },
      batchId: "dev-seed",
      costCents: 0,
    });
    const jobId = await ctx.db.insert("renderJobs", {
      conceptId,
      kind: "preview",
      status: "pending",
      priority: 10,
      attempts: 0,
    });
    return { jobId, conceptId };
  },
});

/** Dev: put failed jobs back in the queue after a worker-side bug fix.
 *  Run: npx convex run dev:resetFailedJobs */
export const resetFailedJobs = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const rows = await ctx.db
      .query("renderJobs")
      .withIndex("by_status_and_priority", (q) => q.eq("status", "failed"))
      .take(100);
    for (const job of rows) {
      await ctx.db.patch("renderJobs", job._id, {
        status: "pending",
        attempts: 0,
        error: undefined,
        claimedBy: undefined,
        claimedAt: undefined,
      });
      await ctx.db.patch("concepts", job.conceptId, { status: "draft" });
    }
    return rows.length;
  },
});

// Dev-only: hand the M1 dev user's rendered concepts to a real account so the
// Calendar can schedule them (sandbox e2e + audit demo video).
// Run: npx convex run dev:adoptRendered '{"email":"<clerk user email>"}'
export const adoptRendered = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const users = await ctx.db.query("users").take(20);
    const real = users.find((u) => u.clerkId && u.clerkId.startsWith("user_"));
    if (!real) throw new Error("no clerk-backed user found");
    const rendered = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status")
      .filter((q) => q.eq(q.field("status"), "rendered"))
      .take(20);
    let moved = 0;
    for (const c of rendered) {
      if (c.userId !== real._id) {
        await ctx.db.patch("concepts", c._id, { userId: real._id });
        moved++;
      }
    }
    return { adoptedBy: real._id, moved, total: rendered.length };
  },
});
