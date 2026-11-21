/** Operator-only switches. Internal functions: reachable from `npx convex run`
 *  and the Convex dashboard, never from the app or the public API. */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentUserId } from "./users";

/** Make an account a team test account (unlimited videos) or back to normal. */
export const setSuperUser = internalMutation({
  args: { email: v.string(), on: v.boolean() },
  handler: async (ctx: MutationCtx, args) => {
    const email = args.email.trim().toLowerCase();
    const rows = await ctx.db.query("users").take(1000);
    const matches = rows.filter((u) => u.email.toLowerCase() === email);
    if (matches.length === 0) throw new Error(`no user with email ${email}`);
    for (const u of matches) await ctx.db.patch("users", u._id, { superUser: args.on || undefined });
    return { email, superUser: args.on, accounts: matches.length };
  },
});

/** Give a beta tester a larger one-time allowance in place of the 3 free videos.
 *  Works before they sign up: with no users row yet the grant is parked in
 *  pendingGrants and users:ensureCurrent applies it on their first sign-in. */
export const setVideoGrant = internalMutation({
  args: { email: v.string(), videos: v.number() },
  handler: async (ctx: MutationCtx, args) => {
    const email = args.email.trim().toLowerCase();
    const videos = Math.max(0, Math.floor(args.videos));
    const rows = await ctx.db.query("users").take(1000);
    const matches = rows.filter((u) => u.email.toLowerCase() === email);
    if (matches.length > 0) {
      for (const u of matches) await ctx.db.patch("users", u._id, { videoGrant: videos || undefined });
      return { email, videos, accounts: matches.length, pending: false };
    }
    // Not signed up yet — park it. One row per email.
    const parked = await ctx.db
      .query("pendingGrants")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (videos === 0) {
      if (parked) await ctx.db.delete("pendingGrants", parked._id);
      return { email, videos, accounts: 0, pending: false };
    }
    if (parked) await ctx.db.patch("pendingGrants", parked._id, { videos });
    else await ctx.db.insert("pendingGrants", { email, videos });
    return { email, videos, accounts: 0, pending: true };
  },
});

/** Grants waiting for their tester to sign up. */
export const listPendingGrants = internalQuery({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const rows = await ctx.db.query("pendingGrants").take(200);
    return rows.map((r) => ({ email: r.email, videos: r.videos, setAt: new Date(r._creationTime).toISOString() }));
  },
});

/** What testers have told us. */
export const listFeedback = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx: QueryCtx, args) => {
    const rows = await ctx.db.query("feedback").order("desc").take(args.limit ?? 25);
    return rows.map((f) => ({ at: new Date(f._creationTime).toISOString(), from: f.email, page: f.page, message: f.message, handled: !!f.handled }));
  },
});

/** What has broken, newest first. */
export const listAlerts = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx: QueryCtx, args) => {
    const rows = await ctx.db.query("alerts").order("desc").take(args.limit ?? 25);
    return rows.map((a) => ({ at: new Date(a._creationTime).toISOString(), kind: a.kind, who: a.userEmail ?? "-", emailed: !!a.notifiedAt, message: a.message.slice(0, 200) }));
  },
});

// ── in-app admin (public functions, but every one checks the super-user flag) ──

export async function requireSuperUser(ctx: QueryCtx | MutationCtx) {
  const userId = await currentUserId(ctx);
  if (!userId) return null;
  const me = await ctx.db.get("users", userId);
  return me?.superUser ? me : null;
}

/** Is the signed-in user allowed to see the operator screen? */
export const amIAdmin = query({
  args: {},
  handler: async (ctx: QueryCtx) => !!(await requireSuperUser(ctx)),
});

/** The pilot dashboard: who is testing, what they said, what broke. */
export const operatorView = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    if (!(await requireSuperUser(ctx))) return null;
    const users = await ctx.db.query("users").take(200);
    const feedback = await ctx.db.query("feedback").order("desc").take(20);
    const alerts = await ctx.db.query("alerts").order("desc").take(20);
    // Per-user indexed counts (capped at 500 each), not a scan of the whole table.
    const testers = [];
    for (const u of users) {
      const videos = await ctx.db
        .query("concepts")
        .withIndex("by_userId_and_status", (q) => q.eq("userId", u._id).eq("status", "rendered"))
        .take(500);
      const posts = await ctx.db.query("posts").withIndex("by_userId", (q) => q.eq("userId", u._id)).take(500);
      testers.push({
        email: u.email,
        plan: u.plan,
        grant: u.videoGrant ?? null,
        team: !!u.superUser,
        guestEndsAt: u.guestExpiresAt ?? null,
        used: u.videosUsedThisPeriod,
        joined: u._creationTime,
        videos: videos.length,
        posts: posts.length,
      });
    }
    return {
      testers,
      feedback: feedback.map((f) => ({ at: f._creationTime, from: f.email, page: f.page, message: f.message })),
      alerts: alerts.map((a) => ({ at: a._creationTime, kind: a.kind, who: a.userEmail ?? null, emailed: !!a.notifiedAt, message: a.message })),
    };
  },
});
