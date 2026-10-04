/** "Something's wrong" from inside the app. One mutation, stored forever, and
 *  it raises an alert so we hear about it without polling. */
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentUserId } from "./users";

const MAX_PER_DAY = 20;

export const submit = mutation({
  args: { message: v.string(), page: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const message = args.message.trim();
    if (message.length < 3) throw new ConvexError("FEEDBACK|empty|Tell us what happened first.");
    const userId = await currentUserId(ctx);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("FEEDBACK|signed_out|Sign in to send feedback.");
    const email = (identity.email as string | undefined) ?? "";

    // Light abuse guard: a user can't flood us.
    if (userId) {
      const recent = await ctx.db.query("feedback").order("desc").take(100);
      const mine = recent.filter((f) => f.userId === userId && f._creationTime > Date.now() - 24 * 60 * 60 * 1000);
      if (mine.length >= MAX_PER_DAY) throw new ConvexError("FEEDBACK|too_many|That's plenty for today — we've got them, thank you.");
    }

    await ctx.db.insert("feedback", { userId: userId ?? undefined, email, page: args.page.slice(0, 120), message: message.slice(0, 4000) });
    await ctx.scheduler.runAfter(0, internal.alerts.raiseFromFeedback, {
      email,
      page: args.page.slice(0, 120),
      message: message.slice(0, 1000),
    });
    return null;
  },
});
