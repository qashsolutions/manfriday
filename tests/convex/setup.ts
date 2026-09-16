import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

export const modules = import.meta.glob("../../convex/**/*.ts");

export function harness() {
  return convexTest(schema, modules);
}

export const CLERK_ID = "user_test_owner";
export const OTHER_CLERK_ID = "user_test_other";

/** Seed a signed-in user with a brand, one template per format, and a rendered concept. */
export async function seed(t: ReturnType<typeof convexTest>, opts: { presenter?: boolean; format?: "slideshow" | "hook_video" | "avatar" } = {}) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK_ID, email: "owner@example.com", plan: "free", credits: 0, videosUsedThisPeriod: 0, timezone: "UTC",
    });
    const presenterImageId = opts.presenter ? await ctx.storage.store(new Blob(["jpg"], { type: "image/jpeg" })) : undefined;
    const brandId = await ctx.db.insert("brands", {
      userId, url: "https://example.com/app", name: "Demo", oneLiner: "x", audience: [], tone: [], niche: "solo-saas",
      language: "en", screenshotIds: [], status: "ready", briefVersion: 1,
      ...(presenterImageId ? { presenterImageId, presenterConsentAt: Date.now() } : {}),
    });
    const format = opts.format ?? "hook_video";
    const templateId = await ctx.db.insert("trendTemplates", {
      slug: `t-${format}`, format, niches: ["solo-saas"], hookPattern: "pov", refUrl: "https://example.com/ref",
      refStats: { platform: "tiktok", views: 1000, capturedAt: 0 }, structure: { slots: [{ id: "hook", type: "text", maxChars: 80 }] },
      specVersion: 1, engagementScore: 50, active: true,
    });
    const videoId = await ctx.storage.store(new Blob(["mp4"], { type: "video/mp4" }));
    const conceptId = await ctx.db.insert("concepts", {
      userId, brandId, templateId, briefVersion: 1, specVersion: 1, language: "en", status: "rendered",
      slots: { hook: "Nobody told me", caption: "Nobody told me #buildinpublic #solofounder" }, videoId, batchId: "b1", costCents: 6,
    });
    const youtube = await ctx.db.insert("socialAccounts", {
      userId, platform: "youtube", handle: "Demo Channel", accessToken: "ya29.secret", refreshToken: "1//secret",
      expiresAt: Date.now() + 3600_000, status: "connected",
    });
    return { userId, brandId, templateId, conceptId, youtube, videoId };
  });
}

export type Seed = Awaited<ReturnType<typeof seed>>;
export type { Id };
