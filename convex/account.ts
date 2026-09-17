import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { currentUserId } from "./users";

/** Self-serve "delete account & data" (privacy policy › Deletion; YouTube API
 *  Services data-retention rule). Called by Settings BEFORE the Clerk user is
 *  deleted, so the Convex side never outlives the identity.
 *
 *  Order matters: revoke every social grant at the provider first (tokens are
 *  the crown jewels), then delete rows leaf-first so nothing dangles.
 *  Everything here is bounded by the user's own rows; nothing global is touched. */
export const purgeMine = mutation({
  args: { confirm: v.literal("DELETE") },
  handler: async (ctx: MutationCtx, _args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

    // 0. Billing: a deleted account must never be charged again. Cancel the
    //    subscription at Stripe right away (runs once this mutation commits).
    //    Stripe keeps its own payment records, as the law requires.
    const me = await ctx.db.get("users", userId);
    if (me?.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(0, internal.billing.cancelSubscriptionNow, { subscriptionId: me.stripeSubscriptionId });
      bump("stripeSubscriptionsCanceled");
    }

    // 1. Social accounts: revoke at provider, wipe tokens, delete.
    const accounts: Doc<"socialAccounts">[] = await ctx.db
      .query("socialAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const a of accounts) {
      if (a.accessToken || a.refreshToken) {
        await ctx.scheduler.runAfter(0, internal.oauth.revokeAtProvider, {
          platform: a.platform,
          accessToken: a.accessToken,
          refreshToken: a.refreshToken,
        });
      }
      await ctx.db.delete("socialAccounts", a._id);
      bump("socialAccounts");
    }

    // 2. Posts → publications → metrics; tracked links → clicks.
    const posts: Doc<"posts">[] = await ctx.db
      .query("posts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const post of posts) {
      const pubs: Doc<"publications">[] = await ctx.db
        .query("publications")
        .withIndex("by_postId", (q) => q.eq("postId", post._id))
        .collect();
      for (const pub of pubs) {
        const metrics: Doc<"metrics">[] = await ctx.db
          .query("metrics")
          .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", pub._id))
          .collect();
        for (const m of metrics) {
          await ctx.db.delete("metrics", m._id);
          bump("metrics");
        }
        await ctx.db.delete("publications", pub._id);
        bump("publications");
      }
      const links: Doc<"trackedLinks">[] = await ctx.db
        .query("trackedLinks")
        .withIndex("by_postId", (q) => q.eq("postId", post._id))
        .collect();
      for (const link of links) {
        const clicks: Doc<"linkClicks">[] = await ctx.db
          .query("linkClicks")
          .withIndex("by_linkId_and_clickedAt", (q) => q.eq("linkId", link._id))
          .collect();
        for (const c of clicks) {
          await ctx.db.delete("linkClicks", c._id);
          bump("linkClicks");
        }
        await ctx.db.delete("trackedLinks", link._id);
        bump("trackedLinks");
      }
      await ctx.db.delete("posts", post._id);
      bump("posts");
    }

    // 3. Concepts (all statuses) → render jobs + stored media.
    const statuses = ["draft", "preview_ready", "kept", "skipped", "render_queued", "rendered", "failed"] as const;
    const conceptIds = new Set<Id<"concepts">>();
    for (const status of statuses) {
      const rows: Doc<"concepts">[] = await ctx.db
        .query("concepts")
        .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", status))
        .collect();
      for (const c of rows) {
        conceptIds.add(c._id);
        if (c.previewThumbId) await ctx.storage.delete(c.previewThumbId);
        if (c.videoId) await ctx.storage.delete(c.videoId);
        await ctx.db.delete("concepts", c._id);
        bump("concepts");
      }
    }
    // renderJobs has no user index; it is small and bounded — filter by the ids we just removed.
    const jobs: Doc<"renderJobs">[] = await ctx.db.query("renderJobs").collect();
    for (const j of jobs) {
      if (conceptIds.has(j.conceptId)) {
        await ctx.db.delete("renderJobs", j._id);
        bump("renderJobs");
      }
    }

    // 4. Brands (+ screenshots) and per-brand voice edits.
    const brands: Doc<"brands">[] = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const b of brands) {
      for (const sid of b.screenshotIds) await ctx.storage.delete(sid);
      const edits: Doc<"voiceEdits">[] = await ctx.db
        .query("voiceEdits")
        .withIndex("by_brandId", (q) => q.eq("brandId", b._id))
        .collect();
      for (const e of edits) {
        await ctx.db.delete("voiceEdits", e._id);
        bump("voiceEdits");
      }
      await ctx.db.delete("brands", b._id);
      bump("brands");
    }

    // 5. Pipeline requests, credit ledger, pending OAuth states, the user row.
    const reqs: Doc<"pipelineRequests">[] = await ctx.db
      .query("pipelineRequests")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const r of reqs) {
      await ctx.db.delete("pipelineRequests", r._id);
      bump("pipelineRequests");
    }
    const ledger: Doc<"creditLedger">[] = await ctx.db
      .query("creditLedger")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const l of ledger) {
      await ctx.db.delete("creditLedger", l._id);
      bump("creditLedger");
    }
    const states: Doc<"oauthStates">[] = await ctx.db.query("oauthStates").collect();
    for (const st of states) {
      if (st.userId === userId) {
        await ctx.db.delete("oauthStates", st._id);
        bump("oauthStates");
      }
    }
    await ctx.db.delete("users", userId);
    bump("users");
    return counts;
  },
});
