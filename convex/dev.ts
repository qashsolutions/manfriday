import { v } from "convex/values";
import { createTrackedLink, withUtm } from "./links";
import { internalQuery, internalMutation } from "./_generated/server";
import { quotaKey } from "./youtubeQuota";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

// Dev-only: hand the M1 dev user's brand to the real account too, so the
// Settings/onboarding language chip (docs/language-ux.md) has a brand to edit.
// Run: npx convex run dev:adoptBrand
export const adoptBrand = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const users = await ctx.db.query("users").take(20);
    const real = users.find((u) => u.clerkId && u.clerkId.startsWith("user_"));
    if (!real) throw new Error("no clerk-backed user found");
    const brands = await ctx.db.query("brands").order("desc").take(5);
    const brand = brands.find((b) => b.status === "ready") ?? brands[0];
    if (!brand) throw new Error("no brand to adopt");
    if (brand.userId !== real._id) await ctx.db.patch("brands", brand._id, { userId: real._id });
    return { brandId: brand._id, name: brand.name, language: brand.language, adoptedBy: real._id };
  },
});

// Dev-only: file an "also in" variant request for the real user's newest
// rendered concept without going through the UI (e2e run of the worker path).
// Run: npx convex run dev:requestVariantFor '{"language":"hi","languageStyle":"code-mixed"}'
export const requestVariantFor = internalMutation({
  args: {
    language: v.string(),
    languageStyle: v.optional(v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"))),
  },
  handler: async (ctx: MutationCtx, args) => {
    const users = await ctx.db.query("users").take(20);
    const real = users.find((u) => u.clerkId && u.clerkId.startsWith("user_"));
    if (!real) throw new Error("no clerk-backed user found");
    const rendered = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", real._id).eq("status", "rendered"))
      .order("desc")
      .take(10);
    const source = rendered.find((c) => !c.variantOf && c.language !== args.language);
    if (!source) throw new Error("no rendered source concept");
    const brand = await ctx.db.get("brands", source.brandId);
    const requestId = await ctx.db.insert("pipelineRequests", {
      userId: real._id,
      url: brand?.url ?? "",
      kind: "variant",
      conceptId: source._id,
      language: args.language,
      languageStyle: args.languageStyle,
      status: "pending",
      brandId: source.brandId,
    });
    return { requestId, sourceConceptId: source._id, sourceLanguage: source.language, hook: JSON.stringify(source.slots).slice(0, 120) };
  },
});

// Dev-only: keep a specific preview_ready concept (what a right-swipe does),
// so a hook/avatar video can be rendered ahead of a demo recording.
// Run: npx convex run dev:keepConcept '{"conceptId":"..."}'
export const keepConcept = internalMutation({
  args: { conceptId: v.id("concepts") },
  handler: async (ctx: MutationCtx, args) => {
    const c = await ctx.db.get("concepts", args.conceptId);
    if (!c) throw new Error("no concept");
    if (c.status !== "preview_ready") return { status: c.status };
    await ctx.db.patch("concepts", args.conceptId, { status: "render_queued", swipedAt: Date.now() });
    await ctx.db.insert("renderJobs", { conceptId: args.conceptId, kind: "final", status: "pending", priority: 20, attempts: 0 });
    return { status: "render_queued" };
  },
});

// Dev-only: re-queue the newest failed publication for immediate publish
// (e.g. to exercise a token refresh). Run: npx convex run dev:retryPublication
export const retryPublication = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const rows = await ctx.db.query("publications").order("desc").take(10);
    const failed = rows.find((p) => p.status === "failed");
    if (!failed) throw new Error("no failed publication");
    await ctx.db.patch("publications", failed._id, { status: "queued", publishAt: Date.now() - 1000, attempts: 0, lastError: undefined });
    return { publicationId: failed._id, platform: failed.platform };
  },
});

// Dev-only: queue a fresh final render for an already-rendered concept (e.g.
// after a TTS provider change). Run: npx convex run dev:rerenderConcept '{"conceptId":"..."}'
export const rerenderConcept = internalMutation({
  args: { conceptId: v.id("concepts") },
  handler: async (ctx: MutationCtx, args) => {
    const c = await ctx.db.get("concepts", args.conceptId);
    if (!c) throw new Error("no concept");
    await ctx.db.patch("concepts", args.conceptId, { status: "render_queued" });
    await ctx.db.insert("renderJobs", { conceptId: args.conceptId, kind: "final", status: "pending", priority: 20, attempts: 0 });
    return { status: "render_queued" };
  },
});

// Dev-only: exercise the tracked-link path without publishing anything — schedule
// the newest rendered concept 30 days out, return the short link; undo with dev:unschedulePost.
// Run: npx convex run dev:scheduleFuture
export const scheduleFuture = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const users = await ctx.db.query("users").take(20);
    const real = users.find((u) => u.clerkId && u.clerkId.startsWith("user_"));
    if (!real) throw new Error("no clerk-backed user found");
    const rendered = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", real._id).eq("status", "rendered"))
      .order("desc")
      .take(1);
    const concept = rendered[0];
    if (!concept) throw new Error("no rendered concept");
    const brand = await ctx.db.get("brands", concept.brandId);
    const postId = await ctx.db.insert("posts", {
      userId: real._id,
      conceptId: concept._id,
      publishAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      captionByPlatform: { tiktok: "test", youtube: "test" },
    });
    const short = await createTrackedLink(ctx, postId, withUtm(brand?.url ?? "https://manfriday.app"));
    return { postId, short };
  },
});

// Run: npx convex run dev:unschedulePost '{"postId":"..."}'
export const unschedulePost = internalMutation({
  args: { postId: v.id("posts") },
  handler: async (ctx: MutationCtx, args) => {
    const pubs = await ctx.db.query("publications").withIndex("by_postId", (q) => q.eq("postId", args.postId)).collect();
    for (const p of pubs) await ctx.db.delete("publications", p._id);
    const links = await ctx.db.query("trackedLinks").withIndex("by_postId", (q) => q.eq("postId", args.postId)).collect();
    for (const l of links) {
      const clicks = await ctx.db.query("linkClicks").withIndex("by_linkId_and_clickedAt", (q) => q.eq("linkId", l._id)).collect();
      for (const c of clicks) await ctx.db.delete("linkClicks", c._id);
      await ctx.db.delete("trackedLinks", l._id);
    }
    await ctx.db.delete("posts", args.postId);
    return { removed: { publications: pubs.length, links: links.length } };
  },
});

// Dev-only: avatar-format concepts of the real user, newest first, with status.
// Run: npx convex run dev:avatarCandidates
export const avatarCandidates = internalQuery({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const users = await ctx.db.query("users").take(20);
    const real = users.find((u) => u.clerkId && u.clerkId.startsWith("user_"));
    if (!real) return [];
    const out: Array<{ id: string; status: string; hook: string }> = [];
    for (const status of ["preview_ready", "kept", "rendered", "render_queued", "failed"] as const) {
      const rows = await ctx.db
        .query("concepts")
        .withIndex("by_userId_and_status", (q) => q.eq("userId", real._id).eq("status", status))
        .order("desc")
        .take(30);
      for (const c of rows) {
        const t = await ctx.db.get("trendTemplates", c.templateId);
        if (t?.format === "avatar") out.push({ id: c._id, status, hook: String((c.slots as Record<string, string>)?.hook_overlay ?? "").slice(0, 60) });
      }
    }
    return out;
  },
});

/** Read-only: which platforms are connected, without touching tokens. */
export const accountStates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("socialAccounts").take(20);
    const users = await ctx.db.query("users").take(20);
    const emailOf = (id: string) => users.find((u) => u._id === id)?.email ?? "?";
    return {
      users: await Promise.all(users.map(async (u) => ({
        id: u._id, email: u.email,
        concepts: (await ctx.db.query("concepts").withIndex("by_userId_and_status", (q) => q.eq("userId", u._id)).take(200)).length,
        posts: (await ctx.db.query("posts").withIndex("by_userId", (q) => q.eq("userId", u._id)).take(50)).length,
      }))),
      accounts: rows.map((a) => ({ platform: a.platform, handle: a.handle, status: a.status, owner: emailOf(a.userId) })),
    };
  },
});

/** UI-only fixture for eyeballing Calendar rows. The TikTok row is terminal
 *  (draft_fallback) and the YouTube rows sit 30+ days out, so the publish cron
 *  (queued AND publishAt <= now) can never pick any of them up. Remove with
 *  dev:removeQueueFixture. */
export const seedQueueFixture = internalMutation({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.query("users").first();
    const concept = await ctx.db.query("concepts").withIndex("by_userId_and_status", (q) => q.eq("userId", user!._id).eq("status", "rendered")).first()
      ?? await ctx.db.query("concepts").first();
    const accounts = await ctx.db.query("socialAccounts").take(5);
    const tiktok = accounts.find((a) => a.platform === "tiktok");
    const youtube = accounts.find((a) => a.platform === "youtube");
    const far = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const postId = await ctx.db.insert("posts", {
      userId: user!._id, conceptId: concept!._id, publishAt: far,
      captionByPlatform: { tiktok: "fixture", youtube: "fixture" },
    });
    if (tiktok) {
      await ctx.db.insert("publications", { postId, accountId: tiktok._id, platform: "tiktok", status: "draft_fallback", publishAt: far, attempts: 1, idempotencyKey: `fx-tt-${postId}` });
    }
    if (youtube) {
      await ctx.db.insert("publications", { postId, accountId: youtube._id, platform: "youtube", status: "queued", publishAt: far, attempts: 0, idempotencyKey: `fx-yt-${postId}` });
    }
    const postId2 = await ctx.db.insert("posts", {
      userId: user!._id, conceptId: concept!._id, publishAt: far + 86_400_000,
      captionByPlatform: { youtube: "fixture deferred" },
    });
    if (youtube) {
      await ctx.db.insert("publications", { postId: postId2, accountId: youtube._id, platform: "youtube", status: "queued", publishAt: far + 86_400_000, attempts: 1, lastError: "QUOTA_DEFERRED: quotaExceeded", idempotencyKey: `fx-def-${postId2}` });
    }
    return { postId, postId2 };
  },
});

export const removeQueueFixture = internalMutation({
  args: {},
  handler: async (ctx) => {
    let removed = 0;
    const pubs = await ctx.db.query("publications").take(200);
    for (const p of pubs) {
      if (!p.idempotencyKey.startsWith("fx-")) continue;
      await ctx.db.delete("publications", p._id);
      const siblings = await ctx.db.query("publications").withIndex("by_postId", (q) => q.eq("postId", p.postId)).take(5);
      if (siblings.length === 0) await ctx.db.delete("posts", p.postId);
      removed++;
    }
    // Any fixture post left without publications.
    const posts = await ctx.db.query("posts").take(200);
    for (const post of posts) {
      const caps = post.captionByPlatform as Record<string, string>;
      if (!Object.values(caps).some((c) => c.startsWith("fixture"))) continue;
      const pubsLeft = await ctx.db.query("publications").withIndex("by_postId", (q) => q.eq("postId", post._id)).take(5);
      if (pubsLeft.length === 0) { await ctx.db.delete("posts", post._id); removed++; }
    }
    return { removed };
  },
});

/** Does the signed-in Clerk identity resolve to a users row? Diagnostics only. */
export const whoAmI = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId)).unique();
    const all = await ctx.db.query("users").take(20);
    return { matched: row ? row.email : null, storedClerkIds: all.map((u) => ({ email: u.email, clerkId: u.clerkId })) };
  },
});

/** Temporarily fill today's YouTube quota so the Calendar's "next open slot"
 *  notice can be eyeballed. Reverse with dev:clearQuotaForToday. */
export const fillQuotaForToday = internalMutation({
  args: { at: v.number() },
  handler: async (ctx, args) => {
    const key = quotaKey(args.at);
    const row = await ctx.db.query("quotaCounters").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (row) await ctx.db.patch("quotaCounters", row._id, { used: 10_000, limit: 10_000 });
    else await ctx.db.insert("quotaCounters", { key, used: 10_000, limit: 10_000 });
    return key;
  },
});

export const clearQuotaForToday = internalMutation({
  args: { at: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("quotaCounters").withIndex("by_key", (q) => q.eq("key", quotaKey(args.at))).first();
    if (row) await ctx.db.delete("quotaCounters", row._id);
    return row ? "cleared" : "nothing to clear";
  },
});

/** Read-only: a user's billing fields (no tokens, no Stripe secrets). */
export const billingState = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const u = (await ctx.db.query("users").take(1000)).find((x) => x.email === args.email);
    if (!u) return null;
    const events = await ctx.db.query("stripeEvents").order("desc").take(10);
    return {
      plan: u.plan, tier: u.tier, term: u.term, superUser: u.superUser ?? false,
      hasCustomer: !!u.stripeCustomerId, hasSubscription: !!u.stripeSubscriptionId,
      periodAnchorAt: u.periodAnchorAt ? new Date(u.periodAnchorAt).toISOString() : null,
      used: u.videosUsedThisPeriod, topup: u.topupVideos ?? 0, paymentFailed: !!u.paymentFailedAt,
      recentEvents: events.map((e) => e.type),
    };
  },
});

/** Deterministic fixture for the browser tests: one brand and a handful of
 *  swipeable concepts for ONE account, so the Picks → keep → schedule → approve
 *  path can be driven without running the pipeline (no Claude, no FAL, no
 *  render worker, no cost). Idempotent: re-running clears what it made first. */
export const seedE2E = internalMutation({
  args: { email: v.string(), concepts: v.optional(v.number()) },
  handler: async (ctx: MutationCtx, args) => {
    const email = args.email.trim().toLowerCase();
    const users = await ctx.db.query("users").take(1000);
    const user = users.find((u) => u.email.toLowerCase() === email);
    if (!user) throw new Error(`no user with email ${email}`);

    await clearE2E(ctx, user._id);

    const templateId = await ctx.db.insert("trendTemplates", {
      slug: E2E_TAG, format: "slideshow", niches: ["solo-saas"], hookPattern: "pov",
      refUrl: "https://example.com/e2e-reference",
      refStats: { platform: "tiktok", views: 128000, capturedAt: Date.now() },
      structure: { slots: [{ id: "hook", type: "text", maxChars: 90 }] },
      specVersion: 1, engagementScore: 70, active: false,
    });
    const brandId = await ctx.db.insert("brands", {
      userId: user._id, url: E2E_BRAND_URL, name: "E2E Fixture", oneLiner: "A fixture product",
      audience: ["solo founders"], tone: ["direct"], niche: "solo-saas", language: "en",
      screenshotIds: [], status: "ready", briefVersion: 1,
    });

    const howMany = Math.max(1, Math.min(10, Math.floor(args.concepts ?? 3)));
    const ids = [];
    for (let i = 1; i <= howMany; i++) {
      ids.push(
        await ctx.db.insert("concepts", {
          userId: user._id, brandId, templateId, briefVersion: 1, specVersion: 1,
          language: "en", status: "preview_ready",
          slots: { hook: `E2E fixture concept ${i}`, caption: `E2E fixture concept ${i} #buildinpublic` },
          batchId: E2E_TAG, costCents: 0,
        }),
      );
    }
    // One already-rendered concept with a post that has NOT been approved, so
    // the Calendar's approval gate has something real to act on without a
    // render worker having to run.
    const renderedId = await ctx.db.insert("concepts", {
      userId: user._id, brandId, templateId, briefVersion: 1, specVersion: 1,
      language: "en", status: "rendered",
      slots: { hook: "E2E fixture awaiting approval", caption: "E2E fixture awaiting approval" },
      batchId: E2E_TAG, costCents: 0,
    });
    const postId = await ctx.db.insert("posts", {
      userId: user._id, conceptId: renderedId,
      publishAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
      captionByPlatform: { youtube: "E2E fixture awaiting approval" },
    });

    return { email, brandId, templateId, concepts: ids.length, awaitingApproval: postId };
  },
});

/** Remove everything seedE2E made for this account. */
export const clearE2EFor = internalMutation({
  args: { email: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const email = args.email.trim().toLowerCase();
    const users = await ctx.db.query("users").take(1000);
    const user = users.find((u) => u.email.toLowerCase() === email);
    if (!user) throw new Error(`no user with email ${email}`);
    return await clearE2E(ctx, user._id);
  },
});

const E2E_TAG = "e2e-fixture";
const E2E_BRAND_URL = "https://e2e-fixture.example/app";

async function clearE2E(ctx: MutationCtx, userId: Id<"users">) {
  let removed = 0;
  const concepts = await ctx.db.query("concepts").take(1000);
  const mine = concepts.filter((c) => c.userId === userId && c.batchId === E2E_TAG);
  const conceptIds = new Set(mine.map((c) => c._id));
  const posts = await ctx.db.query("posts").take(500);
  for (const p of posts) {
    if (p.userId !== userId || !conceptIds.has(p.conceptId)) continue;
    const pubs = await ctx.db.query("publications").withIndex("by_postId", (q) => q.eq("postId", p._id)).take(10);
    for (const pub of pubs) { await ctx.db.delete("publications", pub._id); removed++; }
    await ctx.db.delete("posts", p._id); removed++;
  }
  for (const c of mine) { await ctx.db.delete("concepts", c._id); removed++; }
  const brands = await ctx.db.query("brands").take(500);
  for (const b of brands) {
    if (b.userId !== userId || b.url !== E2E_BRAND_URL) continue;
    await ctx.db.delete("brands", b._id); removed++;
  }
  const templates = await ctx.db.query("trendTemplates").take(1000);
  for (const t of templates) { if (t.slug === E2E_TAG) { await ctx.db.delete("trendTemplates", t._id); removed++; } }
  return { removed };
}
