/** Operator-only switches. Internal functions: reachable from `npx convex run`
 *  and the Convex dashboard, never from the app or the public API. */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

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
