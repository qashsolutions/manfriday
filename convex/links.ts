import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/** Tracked links — the north-star metric (CLAUDE.md): every post carries
 *  manfriday.app/l/<slug>, an edge redirect to the user's product that logs the
 *  click. One link per post; the platform is inferred from the Referer at click
 *  time. Deterministic, no model, no third-party analytics. */

export const SITE = "https://manfriday.app";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i look-alikes

function randomSlug(len = 7): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** Create the tracked link for a post; returns the short URL. Called inside
 *  schedulePost (same mutation, so the caption and the link commit together). */
export async function createTrackedLink(ctx: MutationCtx, postId: Id<"posts">, targetUrl: string): Promise<string> {
  let slug = randomSlug();
  for (let tries = 0; tries < 5; tries++) {
    const clash = await ctx.db.query("trackedLinks").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (!clash) break;
    slug = randomSlug();
  }
  await ctx.db.insert("trackedLinks", { postId, slug, targetUrl });
  return `${SITE}/l/${slug}`;
}

/** Append UTM tags so the user's own analytics attribute the visit too. */
export function withUtm(url: string, platformHint = "social"): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "manfriday");
    u.searchParams.set("utm_medium", platformHint);
    return u.toString();
  } catch {
    return url;
  }
}

/** Clicks logged before clickCount existed (21 Nov 2026), excluding the one
 *  just inserted. Those links are days old, so this is a small, one-off read. */
async function legacyClickCount(ctx: MutationCtx, linkId: Id<"trackedLinks">): Promise<number> {
  const rows = await ctx.db
    .query("linkClicks")
    .withIndex("by_linkId_and_clickedAt", (q) => q.eq("linkId", linkId))
    .take(5000);
  return Math.max(0, rows.length - 1);
}

/** Called by the /l/<slug> route: records the click and returns where to send
 *  the visitor. Public and unauthenticated by design (the visitor is anonymous);
 *  it only ever inserts one small row and reveals nothing but the target URL. */
export const click = mutation({
  args: {
    slug: v.string(),
    referrerPlatform: v.optional(v.string()),
    count: v.boolean(), // false for known crawlers/preview bots: redirect, don't log
  },
  handler: async (ctx: MutationCtx, args): Promise<{ targetUrl: string } | null> => {
    const link: Doc<"trackedLinks"> | null = await ctx.db
      .query("trackedLinks")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!link) return null;
    if (args.count) {
      await ctx.db.insert("linkClicks", {
        linkId: link._id,
        clickedAt: Date.now(),
        referrerPlatform: args.referrerPlatform,
      });
      // The running total Analytics reads, so a post that takes off is counted
      // in full. Links older than the counter start from their logged rows once.
      const base = link.clickCount ?? (await legacyClickCount(ctx, link._id));
      await ctx.db.patch("trackedLinks", link._id, { clickCount: base + 1 });
    }
    return { targetUrl: link.targetUrl };
  },
});
