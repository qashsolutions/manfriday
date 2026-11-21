/** Guest accounts: friends testing the product (21 Nov 2026).
 *
 *  - At most GUEST.cap guests at once: accounts still alive plus invites not yet
 *    used and not yet lapsed. Revoking an invite or a guest being deleted frees a slot.
 *  - A guest invite parks a 25-video grant marked `guest`; on first sign-in
 *    users:ensureCurrent turns it into guestExpiresAt = sign-in + GUEST.days.
 *  - When that time comes, the expireDue cron deletes the account: data first
 *    (account.startPurge), then the Clerk sign-in. A guest who pays for a plan
 *    stops being a guest instead.
 *
 *  Every public function here is operator-only (the team flag). */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { requireSuperUser } from "./admin";
import { startPurge } from "./account";
import { standing } from "./allowance";
import { GUEST } from "../lib/site";

const DAY = 24 * 60 * 60 * 1000;

const normalize = (email: string) => email.trim().toLowerCase();

async function requireOperator(ctx: QueryCtx | MutationCtx) {
  if (!(await requireSuperUser(ctx))) throw new ConvexError("GUEST|not_allowed|Only the team can invite guests.");
}

/** Slots in use at `now`: live guest accounts + unexpired, unused guest invites. */
async function slotsInUse(ctx: QueryCtx | MutationCtx, now: number) {
  const live = await ctx.db
    .query("users")
    .withIndex("by_guestExpiresAt", (q) => q.gt("guestExpiresAt", now))
    .take(GUEST.cap + 1);
  const parked = await ctx.db
    .query("pendingGrants")
    .withIndex("by_guest", (q) => q.eq("guest", true))
    .take(100);
  const pending = parked.filter((p) => (p.expiresAt ?? 0) > now);
  return { live, pending };
}

/** Called by the invite route BEFORE Clerk sends anything. Refuses the 11th
 *  guest and anyone who already has an account. Re-inviting the same pending
 *  email refreshes its reservation without using another slot. */
export const reserve = mutation({
  args: { email: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    await requireOperator(ctx);
    const email = normalize(args.email);
    const now = Date.now();
    const users = await ctx.db.query("users").take(1000);
    if (users.some((u) => u.email.toLowerCase() === email)) {
      throw new ConvexError("GUEST|has_account|That email already has an account.");
    }
    const { live, pending } = await slotsInUse(ctx, now);
    const others = pending.filter((p) => p.email !== email);
    const used = live.length + others.length;
    if (used >= GUEST.cap) {
      throw new ConvexError(`GUEST|cap|All ${GUEST.cap} guest slots are in use. Revoke an invite or wait for a guest account to end.`);
    }
    const expiresAt = now + GUEST.inviteDays * DAY;
    const existing = await ctx.db.query("pendingGrants").withIndex("by_email", (q) => q.eq("email", email)).unique();
    const row = { videos: GUEST.videos, guest: true, expiresAt };
    if (existing) await ctx.db.patch("pendingGrants", existing._id, row);
    else await ctx.db.insert("pendingGrants", { email, ...row });
    return { used: used + 1, cap: GUEST.cap, inviteExpiresAt: expiresAt };
  },
});

/** Give a slot back: the Clerk invite failed, or the operator revoked it. */
export const release = mutation({
  args: { email: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    await requireOperator(ctx);
    const email = normalize(args.email);
    const existing = await ctx.db.query("pendingGrants").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (existing?.guest) await ctx.db.delete("pendingGrants", existing._id);
    return null;
  },
});

/** The operator screen's guest panel. `now` comes from the client (queries
 *  never read the clock), rounded to the minute so the result caches. */
export const summary = query({
  args: { now: v.number() },
  handler: async (ctx: QueryCtx, args) => {
    if (!(await requireSuperUser(ctx))) return null;
    const { live, pending } = await slotsInUse(ctx, args.now);
    return {
      cap: GUEST.cap,
      used: live.length + pending.length,
      guests: live.map((u) => ({ email: u.email, endsAt: u.guestExpiresAt!, used: u.videosUsedThisPeriod, grant: u.videoGrant ?? null })),
      invited: pending.map((p) => ({ email: p.email, inviteExpiresAt: p.expiresAt! })),
    };
  },
});

/** Cron: delete guest accounts whose time is up, and drop lapsed invites. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("users")
      .withIndex("by_guestExpiresAt", (q) => q.gt("guestExpiresAt", 0).lte("guestExpiresAt", now))
      .take(10);
    let deleted = 0;
    for (const u of due) {
      if (standing(u, now) === "paid") {
        // They bought a plan: a customer, not a guest. Never auto-delete a payer.
        await ctx.db.patch("users", u._id, { guestExpiresAt: undefined });
        continue;
      }
      if (u.deletingAt) continue;
      await startPurge(ctx, u._id, { deleteIdentity: true });
      deleted += 1;
    }
    const parked = await ctx.db
      .query("pendingGrants")
      .withIndex("by_guest", (q) => q.eq("guest", true))
      .take(100);
    for (const p of parked) {
      if ((p.expiresAt ?? 0) <= now) await ctx.db.delete("pendingGrants", p._id);
    }
    return { deleted };
  },
});

/** Delete the Clerk user (the sign-in) once the data is gone. Needs the Clerk
 *  secret in the Convex environment. A user Clerk no longer has counts as done. */
export const deleteIdentity = internalAction({
  args: { clerkId: v.string() },
  handler: async (ctx: ActionCtx, args) => {
    const key = env.CLERK_SECRET_KEY;
    if (!key) {
      await ctx.runMutation(internal.alerts.raise, {
        kind: "guest_delete_failed",
        message: `Guest data deleted, but the sign-in ${args.clerkId} was not: CLERK_SECRET_KEY is not set in Convex.`,
      });
      return null;
    }
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(args.clerkId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok && res.status !== 404) {
      await ctx.runMutation(internal.alerts.raise, {
        kind: "guest_delete_failed",
        message: `Guest data deleted, but Clerk refused to delete the sign-in ${args.clerkId} (HTTP ${res.status}). Delete it in the Clerk dashboard.`,
      });
    }
    return null;
  },
});
