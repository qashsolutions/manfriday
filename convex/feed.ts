import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentUserId } from "./users";
import { chargeVideo } from "./allowance";
import type { Doc } from "./_generated/dataModel";

/** The Picks feed: the signed-in user's swipeable concepts, newest batch first. */
export const myFeed = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return { concepts: [], kept: 0, pending: 0 };

    const rows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "preview_ready"))
      .order("desc")
      .take(30);
    const keptRows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "kept"))
      .take(100);
    const renderedRows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "rendered"))
      .take(100);
    // Drafts whose preview is still rendering — the screen says so instead of "empty".
    const draftRows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "draft"))
      .take(100);

    const brands = new Map<string, Doc<"brands"> | null>();
    const concepts = [];
    for (const c of rows) {
      const template = await ctx.db.get("trendTemplates", c.templateId);
      if (!brands.has(c.brandId)) brands.set(c.brandId, await ctx.db.get("brands", c.brandId));
      const brand = brands.get(c.brandId) ?? null;
      concepts.push({
        id: c._id,
        slots: c.slots,
        language: c.language,
        languageStyle: c.languageStyle ?? null,
        variantOf: c.variantOf ?? null,
        format: template?.format ?? "slideshow",
        hookPattern: template?.hookPattern ?? "",
        refViews: template?.refStats.views ?? 0,
        refPlatform: template?.refStats.platform ?? "tiktok",
        thumbUrl: c.previewThumbId ? await ctx.storage.getUrl(c.previewThumbId) : null,
        why: template ? whyOf(template, brand) : null,
        words: template ? wordsOf(template, c.slots as Record<string, string>) : [],
      });
    }
    return { concepts, kept: keptRows.length + renderedRows.length, pending: draftRows.length };
  },
});

/** Why this pick might work: the real post it is modelled on, what that post
 *  did, and whether it comes from the user's own space. All curated data —
 *  nothing here is generated. */
export function whyOf(template: Doc<"trendTemplates">, brand: Doc<"brands"> | null) {
  const ref = ((template.structure as { reference?: Record<string, unknown> } | null)?.reference ?? {}) as {
    hook?: string | null;
    concept?: string | null;
    handle?: string | null;
    outlierX?: number | null;
    followers?: number | null;
  };
  const space = brand?.trendNiche ?? brand?.niche ?? null;
  const realUrl = /^https:\/\//.test(template.refUrl) && !template.refUrl.includes("PLACEHOLDER");
  return {
    pattern: template.hookPattern,
    refHook: ref.hook ?? null,
    refConcept: ref.concept ?? null,
    refHandle: ref.handle ?? null,
    refUrl: realUrl ? template.refUrl : null,
    // Views are only claimed for a real, linked post (hand-made starter
    // templates carry placeholder numbers).
    refViews: realUrl ? template.refStats.views : null,
    refPlatform: template.refStats.platform,
    outlierX: typeof ref.outlierX === "number" ? ref.outlierX : null,
    followers: typeof ref.followers === "number" ? ref.followers : null,
    // "none" = the user said the library has nothing from their space.
    fromYourSpace: !!space && space !== "none" && template.niches.includes(space),
    trendSpace: template.niches[0] ?? null,
    yourSpace: brand?.trendNiche === "none" ? (brand?.niche ?? null) : space,
  };
}

const SLOT_LABEL: Record<string, string> = {
  hook: "Headline",
  hook_text: "Headline",
  hook_overlay: "Headline on screen",
  vo_script: "What Friday says",
  cta: "Closing card",
  caption: "Post caption",
};

type SlotSpec = { id: string; type: string; maxChars?: number; targetSeconds?: number };

/** The words of a pick the user may edit before keeping it, with their limits. */
export function editableSlots(template: Doc<"trendTemplates">): { id: string; label: string; max: number }[] {
  const specs = ((template.structure as { slots?: SlotSpec[] } | null)?.slots ?? []) as SlotSpec[];
  return specs
    .filter((s) => s.type === "text" || s.type === "script")
    .map((s) => ({
      id: s.id,
      label: SLOT_LABEL[s.id] ?? s.id.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase()),
      // A spoken script is capped near its target length: much longer and the
      // final video runs past the format's duration cap and fails to render.
      max: s.maxChars ?? Math.round((s.targetSeconds ?? 20) * 18),
    }));
}

function wordsOf(template: Doc<"trendTemplates">, slots: Record<string, string>) {
  return editableSlots(template).map((s) => ({ ...s, value: slots?.[s.id] ?? "" }));
}

/** Edit a pick's words before keeping it. The preview is redrawn (free) so the
 *  card shows the new headline; the full video is rendered from these words. */
export const editWords = mutation({
  args: { conceptId: v.id("concepts"), slots: v.record(v.string(), v.string()) },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const concept = await ctx.db.get("concepts", args.conceptId);
    if (!concept || concept.userId !== userId) throw new Error("not your concept");
    if (concept.status !== "preview_ready") throw new Error("Only a pick you haven't kept or skipped can be edited.");
    const template = await ctx.db.get("trendTemplates", concept.templateId);
    if (!template) throw new Error("template missing");
    const specs = new Map(editableSlots(template).map((s) => [s.id, s]));
    const next: Record<string, string> = { ...(concept.slots as Record<string, string>) };
    let changed = false;
    for (const [id, raw] of Object.entries(args.slots)) {
      const spec = specs.get(id);
      if (!spec) throw new Error(`"${id}" isn't part of this pick`);
      const text = raw.replace(/[ \t]+/g, " ").trim();
      if (!text) throw new Error(`${spec.label} can't be empty.`);
      if (text.length > spec.max) throw new Error(`${spec.label} is ${text.length} characters; the limit is ${spec.max}.`);
      if (next[id] !== text) {
        next[id] = text;
        changed = true;
      }
    }
    if (!changed) return null;
    await ctx.db.patch("concepts", concept._id, { slots: next, previewThumbId: undefined });
    if (concept.previewThumbId) await ctx.storage.delete(concept.previewThumbId);
    await ctx.db.insert("renderJobs", {
      conceptId: concept._id,
      kind: "preview",
      status: "pending",
      priority: 15, // the user is looking at it right now
      attempts: 0,
    });
    return null;
  },
});

/** The signed-in user's finished videos (right-swiped and fully rendered). */
export const myRendered = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("concepts")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", "rendered"))
      .order("desc")
      .take(20);
    // A rendered concept that already has a post is in the queue, not "ready to schedule".
    const out = [];
    for (const c of rows) {
      // A rendered concept that already has a post is in the queue, not "ready".
      const post = await ctx.db
        .query("posts")
        .withIndex("by_userId_and_conceptId", (q) => q.eq("userId", userId).eq("conceptId", c._id))
        .first();
      if (post) continue;
      const template = await ctx.db.get("trendTemplates", c.templateId);
      out.push({
        id: c._id,
        slots: c.slots,
        format: template?.format ?? "slideshow",
        videoUrl: c.videoId ? await ctx.storage.getUrl(c.videoId) : null,
        thumbUrl: c.previewThumbId ? await ctx.storage.getUrl(c.previewThumbId) : null,
      });
    }
    return out;
  },
});

/** The swipe. Right = keep (queues the full-quality lazy render). Left = skip. */
export const swipe = mutation({
  args: { conceptId: v.id("concepts"), keep: v.boolean() },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const concept = await ctx.db.get("concepts", args.conceptId);
    if (!concept || concept.userId !== userId) throw new Error("not your concept");
    if (concept.status !== "preview_ready") return null;

    if (args.keep) {
      // The keep is the billable moment (D5): throws ALLOWANCE|… when nothing is left.
      const billed = await chargeVideo(ctx, userId);
      await ctx.db.patch("concepts", args.conceptId, {
        status: "render_queued",
        swipedAt: Date.now(),
        billedFrom: billed.from,
        billedPeriodStartsAt: billed.periodStart ?? undefined,
      });
      await ctx.db.insert("renderJobs", {
        conceptId: args.conceptId,
        kind: "final",
        status: "pending",
        priority: 20, // finals beat previews (the lazy-render moment)
        attempts: 0,
      });
    } else {
      await ctx.db.patch("concepts", args.conceptId, { status: "skipped", swipedAt: Date.now() });
    }
    return null;
  },
});

const LANGUAGE_CODES = ["en", "es", "pt-BR", "id", "hi", "bn", "ta", "te", "mr", "kn", "ml", "gu", "pa", "or"];

/** Language UX §2: "also in" — one tap after a keep asks the worker to
 *  re-slot-fill the same concept in another market's language. Each variant
 *  is a video against the allowance (metered on the concept row like any other). */
export const requestVariant = mutation({
  args: {
    conceptId: v.id("concepts"),
    language: v.string(),
    languageStyle: v.optional(v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"))),
  },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const concept = await ctx.db.get("concepts", args.conceptId);
    if (!concept || concept.userId !== userId) throw new Error("not your concept");
    if (!["render_queued", "kept", "rendered"].includes(concept.status)) throw new Error("keep the pick first");
    if (!LANGUAGE_CODES.includes(args.language)) throw new Error("unsupported language");
    if (args.language === concept.language) throw new Error("already in that language");
    const brand = await ctx.db.get("brands", concept.brandId);
    const billed = await chargeVideo(ctx, userId);
    await ctx.db.insert("pipelineRequests", {
      userId,
      url: brand?.url ?? "",
      kind: "variant",
      conceptId: args.conceptId,
      language: args.language,
      languageStyle: args.languageStyle,
      status: "pending",
      brandId: concept.brandId,
      billedFrom: billed.from,
      billedPeriodStartsAt: billed.periodStart ?? undefined,
    });
    return null;
  },
});

/** Discard a rendered video from "ready to schedule": the desktop equivalent of a
 *  left-swipe. Marks the concept skipped and deletes its files. Only allowed
 *  while nothing has been scheduled from it (scheduled posts live in the queue). */
export const discard = mutation({
  args: { conceptId: v.id("concepts") },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const c = await ctx.db.get("concepts", args.conceptId);
    if (!c || c.userId !== userId) throw new Error("not your concept");
    if (c.status !== "rendered") throw new Error("only rendered videos can be discarded here");
    const post = await ctx.db
      .query("posts")
      .withIndex("by_userId_and_conceptId", (q) => q.eq("userId", userId).eq("conceptId", c._id))
      .first();
    if (post) throw new Error("this video is already scheduled");
    if (c.videoId) await ctx.storage.delete(c.videoId);
    if (c.previewThumbId) await ctx.storage.delete(c.previewThumbId);
    await ctx.db.patch("concepts", args.conceptId, { status: "skipped", videoId: undefined, previewThumbId: undefined, swipedAt: Date.now() });
    return null;
  },
});
