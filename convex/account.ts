import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { currentUserId } from "./users";

/** Account deletion (privacy policy › Deletion; YouTube API Services
 *  data-retention rule). Two callers:
 *    - Settings › Delete account: purgeMine, then the browser deletes the Clerk user.
 *    - Guest expiry (guests.ts): startPurge with deleteIdentity, so the Clerk user
 *      is deleted by the server once the data is gone.
 *
 *  The urgent part runs at once, in the caller's transaction: cancel billing,
 *  revoke every social grant at the provider and delete the tokens (they are the
 *  crown jewels). The rest — posts, clicks, videos, everything — is deleted in
 *  batches by purgeStep, each a fresh transaction, so an account of any size
 *  can be deleted without hitting Convex's per-transaction limits. The users row
 *  goes last, so a half-finished purge is always visible and always resumable. */

/** Documents (and stored files) deleted per transaction. Well under Convex's
 *  per-mutation limits even when every document is at its largest. */
export const PURGE_BATCH = 400;

/** Social accounts: revoke at provider, wipe tokens, delete. A user has at most
 *  one per platform, so this is always small. */
async function revokeAndDeleteSocial(ctx: MutationCtx, userId: Id<"users">) {
  const accounts = await ctx.db
    .query("socialAccounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(20);
  for (const a of accounts) {
    if (a.accessToken || a.refreshToken) {
      await ctx.scheduler.runAfter(0, internal.oauth.revokeAtProvider, {
        platform: a.platform,
        accessToken: a.accessToken,
        refreshToken: a.refreshToken,
      });
    }
    await ctx.db.delete("socialAccounts", a._id);
  }
}

export async function startPurge(ctx: MutationCtx, userId: Id<"users">, opts: { deleteIdentity: boolean }) {
  const me = await ctx.db.get("users", userId);
  if (!me) return;
  if (me.deletingAt) return; // already under way

  // Billing: a deleted account must never be charged again. Stripe keeps its
  // own payment records, as the law requires.
  if (me.stripeSubscriptionId) {
    await ctx.scheduler.runAfter(0, internal.billing.cancelSubscriptionNow, { subscriptionId: me.stripeSubscriptionId });
  }

  await revokeAndDeleteSocial(ctx, userId);
  await ctx.db.patch("users", userId, { deletingAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.account.purgeStep, {
    userId,
    clerkId: opts.deleteIdentity ? me.clerkId : undefined,
  });
}

/** Self-serve "delete account & data". Called by Settings BEFORE the Clerk user
 *  is deleted. Returns at once; the rest of the data follows within seconds. */
export const purgeMine = mutation({
  args: { confirm: v.literal("DELETE") },
  handler: async (ctx: MutationCtx, _args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    await startPurge(ctx, userId, { deleteIdentity: false });
    return { started: true };
  },
});

/** Delete up to PURGE_BATCH of the user's documents, leaf-first, then schedule
 *  itself again. The users row is deleted only when nothing else is left. */
export const purgeStep = internalMutation({
  args: { userId: v.id("users"), clerkId: v.optional(v.string()) },
  handler: async (ctx: MutationCtx, args) => {
    const { userId } = args;
    let budget = PURGE_BATCH;
    const spend = () => --budget <= 0;
    const again = async () => {
      await ctx.scheduler.runAfter(0, internal.account.purgeStep, args);
      return { done: false };
    };

    // 1. Posts → publications → metrics; tracked links → clicks.
    const posts = await ctx.db.query("posts").withIndex("by_userId", (q) => q.eq("userId", userId)).take(budget);
    for (const post of posts) {
      const pubs = await ctx.db.query("publications").withIndex("by_postId", (q) => q.eq("postId", post._id)).take(10);
      for (const pub of pubs) {
        const metrics = await ctx.db
          .query("metrics")
          .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", pub._id))
          .take(budget);
        for (const m of metrics) {
          await ctx.db.delete("metrics", m._id);
          if (spend()) return await again();
        }
        await ctx.db.delete("publications", pub._id);
        if (spend()) return await again();
      }
      const links = await ctx.db.query("trackedLinks").withIndex("by_postId", (q) => q.eq("postId", post._id)).take(10);
      for (const link of links) {
        const clicks = await ctx.db
          .query("linkClicks")
          .withIndex("by_linkId_and_clickedAt", (q) => q.eq("linkId", link._id))
          .take(budget);
        for (const c of clicks) {
          await ctx.db.delete("linkClicks", c._id);
          if (spend()) return await again();
        }
        await ctx.db.delete("trackedLinks", link._id);
        if (spend()) return await again();
      }
      await ctx.db.delete("posts", post._id);
      if (spend()) return await again();
    }
    if (posts.length > 0) return await again();

    // 2. Concepts (every status) → their render jobs and stored media.
    const concepts = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId))
      .take(Math.ceil(budget / 4));
    for (const c of concepts) {
      // Jobs first; a concept is deleted only once all its jobs are gone.
      const jobs = await ctx.db.query("renderJobs").withIndex("by_conceptId", (q) => q.eq("conceptId", c._id)).take(budget);
      for (const j of jobs) {
        await ctx.db.delete("renderJobs", j._id);
        if (spend()) return await again();
      }
      if (c.previewThumbId) await ctx.storage.delete(c.previewThumbId);
      if (c.videoId) await ctx.storage.delete(c.videoId);
      await ctx.db.delete("concepts", c._id);
      budget -= 4;
      if (budget <= 0) return await again();
    }
    if (concepts.length > 0) return await again();

    // 3. Brands (+ screenshots, presenter photo) and per-brand voice edits.
    const brands = await ctx.db.query("brands").withIndex("by_userId", (q) => q.eq("userId", userId)).take(5);
    for (const b of brands) {
      const edits = await ctx.db.query("voiceEdits").withIndex("by_brandId", (q) => q.eq("brandId", b._id)).take(budget);
      for (const e of edits) {
        await ctx.db.delete("voiceEdits", e._id);
        if (spend()) return await again();
      }
      const files = [...b.screenshotIds, ...(b.pageShotIds ?? [])];
      for (const sid of files) await ctx.storage.delete(sid);
      if (b.presenterImageId) await ctx.storage.delete(b.presenterImageId);
      await ctx.db.delete("brands", b._id);
      budget -= 1 + files.length;
      if (budget <= 0) return await again();
    }
    if (brands.length > 0) return await again();

    // 4. Pipeline requests, credit ledger, OAuth states.
    const reqs = await ctx.db.query("pipelineRequests").withIndex("by_userId", (q) => q.eq("userId", userId)).take(budget);
    for (const r of reqs) {
      await ctx.db.delete("pipelineRequests", r._id);
      if (spend()) return await again();
    }
    const ledger = await ctx.db.query("creditLedger").withIndex("by_userId", (q) => q.eq("userId", userId)).take(budget);
    for (const l of ledger) {
      await ctx.db.delete("creditLedger", l._id);
      if (spend()) return await again();
    }
    const states = await ctx.db.query("oauthStates").withIndex("by_userId", (q) => q.eq("userId", userId)).take(budget);
    for (const st of states) {
      await ctx.db.delete("oauthStates", st._id);
      if (spend()) return await again();
    }
    // Their reports stay (what testers told us outlives a 21-day guest), but
    // nothing in them identifies the person any more.
    const reports = await ctx.db.query("feedback").withIndex("by_userId", (q) => q.eq("userId", userId)).take(budget);
    for (const f of reports) {
      const { device: _device, ...rest } = f.context ?? {};
      await ctx.db.patch("feedback", f._id, {
        userId: undefined,
        email: "",
        context: f.context ? rest : undefined,
      });
      if (spend()) return await again();
    }
    if (reqs.length + ledger.length + states.length + reports.length > 0) return await again();

    // 5. Social accounts again: one connected after startPurge ran would
    //    otherwise outlive the account with live tokens.
    await revokeAndDeleteSocial(ctx, userId);

    // 6. Last: the user row, then (guests) the sign-in identity.
    const user = await ctx.db.get("users", userId);
    if (user) await ctx.db.delete("users", userId);
    if (args.clerkId) await ctx.scheduler.runAfter(0, internal.guests.deleteIdentity, { clerkId: args.clerkId });
    return { done: true };
  },
});
