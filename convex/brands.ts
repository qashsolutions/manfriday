import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentUserId } from "./users";

const LANGUAGE_CODES = ["en", "es", "pt-BR", "id", "hi", "bn", "ta", "te", "mr", "kn", "ml", "gu", "pa", "or"];
const languageStyle = v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"));

/** The signed-in user's brand (one workspace in v1). */
export const myBrand = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    if (!brand) return null;
    return {
      id: brand._id,
      name: brand.name,
      language: brand.language,
      languageStyle: brand.languageStyle ?? null,
      markets: brand.markets ?? null,
      status: brand.status,
    };
  },
});

/** Language UX §1: the chip/combobox and "how it sounds" write here. Bumps
 *  briefVersion so future concepts pin the new language; existing ones keep theirs. */
export const setLanguage = mutation({
  args: {
    brandId: v.id("brands"),
    language: v.string(),
    languageStyle: v.optional(languageStyle),
  },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const brand = await ctx.db.get("brands", args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not your brand");
    if (!LANGUAGE_CODES.includes(args.language)) throw new Error("unsupported language");
    const changed = brand.language !== args.language || (brand.languageStyle ?? null) !== (args.languageStyle ?? null);
    await ctx.db.patch("brands", args.brandId, {
      language: args.language,
      languageStyle: args.languageStyle,
      briefVersion: changed ? brand.briefVersion + 1 : brand.briefVersion,
    });
    return null;
  },
});
