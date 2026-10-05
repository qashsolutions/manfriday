import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Resolve the signed-in Clerk user to our users row (null when absent). */
export async function currentUserId(ctx: QueryCtx | MutationCtx): Promise<Id<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const row = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  return row?._id ?? null;
}

/** Create-or-fetch the users row for the signed-in identity. Called once on app load. */
export const ensureCurrent = mutation({
  args: { timezone: v.optional(v.string()) },
  handler: async (ctx: MutationCtx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (existing) return existing._id;
    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      email: identity.email ?? "",
      plan: "free",
      credits: 0,
      videosUsedThisPeriod: 0,
      timezone: args.timezone ?? "UTC",
    });
    // First sign-in: say hello and tell them what to do next.
    await ctx.scheduler.runAfter(0, internal.email.welcome, { userId });
    return userId;
  },
});

/** "Keep it and it's on your calendar" — on by default; this turns it off. */
export const setAutoSchedule = mutation({
  args: { on: v.boolean() },
  handler: async (ctx: MutationCtx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const row = await ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject)).unique();
    if (!row) throw new Error("not signed in");
    await ctx.db.patch("users", row._id, { autoSchedule: args.on });
    return null;
  },
});

export const current = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!row) return null;
    return {
      email: row.email,
      autoSchedule: row.autoSchedule !== false,
      plan: row.plan,
      tier: row.tier ?? null,
      term: row.term ?? null,
      videosUsedThisPeriod: row.videosUsedThisPeriod,
    };
  },
});
