import { expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { CLERK_ID, OTHER_CLERK_ID, harness, seed } from "./setup";

/** Fixes from the 23 Nov 2026 product review: the "why" on a pick, editing a
 *  pick's words before keeping it, and a brief the user can correct. */

const STRUCTURE = {
  reference: { hook: "How I built it in 2 hours", concept: "A dev builds an app live", handle: "maker", outlierX: 89, followers: 30200 },
  slots: [
    { id: "hook_text", type: "text", maxChars: 80 },
    { id: "vo_script", type: "script", targetSeconds: 20 },
    { id: "caption", type: "text", maxChars: 150 },
  ],
};

async function withPick(opts: { niches?: string[]; refUrl?: string; trendNiche?: string } = {}) {
  const t = harness();
  const s = await seed(t);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkId: OTHER_CLERK_ID, email: "other@example.com", plan: "free", credits: 0, videosUsedThisPeriod: 0, timezone: "UTC" });
    if (opts.trendNiche) await ctx.db.patch("brands", s.brandId, { trendNiche: opts.trendNiche });
    const templateId = await ctx.db.insert("trendTemplates", {
      slug: "tool-demo-hook-video-maker", format: "hook_video", niches: opts.niches ?? ["solo-saas"], hookPattern: "tool-demo",
      refUrl: opts.refUrl ?? "https://www.tiktok.com/@maker/video/1", refStats: { platform: "tiktok", views: 911600, capturedAt: 0 },
      structure: STRUCTURE, specVersion: 1, engagementScore: 80, active: true,
    });
    const thumb = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
    const conceptId = await ctx.db.insert("concepts", {
      userId: s.userId, brandId: s.brandId, templateId, briefVersion: 1, specVersion: 1, language: "en", status: "preview_ready",
      slots: { hook_text: "My churn dropped 87% in a week", vo_script: "We cut churn by 87 percent.", caption: "87% #saas" },
      previewThumbId: thumb, batchId: "b2", costCents: 0,
    });
    return { templateId, conceptId, thumb };
  });
  return { t, s, ...ids, me: t.withIdentity({ subject: CLERK_ID }), other: t.withIdentity({ subject: OTHER_CLERK_ID }) };
}

test("a pick carries why it could work: the real post, its numbers, and whether it's from your space", async () => {
  const { me } = await withPick();
  const feed = await me.query(api.feed.myFeed, {});
  const why = feed.concepts[0].why!;
  expect(why).toMatchObject({
    pattern: "tool-demo", refHook: "How I built it in 2 hours", refHandle: "maker", refUrl: "https://www.tiktok.com/@maker/video/1",
    refViews: 911600, outlierX: 89, followers: 30200, fromYourSpace: true, trendSpace: "solo-saas",
  });
  expect(feed.concepts[0].words.map((w) => [w.id, w.max])).toEqual([["hook_text", 80], ["vo_script", 360], ["caption", 150]]);
});

test("a trend from another space says so, and a starter template claims no numbers", async () => {
  const { me } = await withPick({ niches: ["dev-tools"], refUrl: "[PLACEHOLDER-TREND-REF]" });
  const why = (await me.query(api.feed.myFeed, {})).concepts[0].why!;
  expect(why.fromYourSpace).toBe(false);
  expect(why.yourSpace).toBe("solo-saas");
  expect(why.refUrl).toBeNull();
  expect(why.refViews).toBeNull();
});

test("'none of these' never counts as a match", async () => {
  const { me } = await withPick({ trendNiche: "none" });
  const why = (await me.query(api.feed.myFeed, {})).concepts[0].why!;
  expect(why.fromYourSpace).toBe(false);
  expect(why.yourSpace).toBe("solo-saas"); // the brand's own niche, named in the note
});

test("editing words saves them, drops the stale preview and queues a fresh one", async () => {
  const { t, me, conceptId, thumb } = await withPick();
  await me.mutation(api.feed.editWords, { conceptId, slots: { hook_text: "  Watch churn reasons appear in one screen  " } });
  const after = await t.run(async (ctx) => ({
    c: await ctx.db.get("concepts", conceptId),
    jobs: (await ctx.db.query("renderJobs").collect()).filter((j) => j.conceptId === conceptId),
    thumb: await ctx.storage.getUrl(thumb),
  }));
  expect(after.c!.slots.hook_text).toBe("Watch churn reasons appear in one screen");
  expect(after.c!.slots.vo_script).toBe("We cut churn by 87 percent."); // untouched slots stay
  expect(after.c!.previewThumbId).toBeUndefined();
  expect(after.thumb).toBeNull();
  expect(after.jobs).toHaveLength(1);
  expect(after.jobs[0]).toMatchObject({ kind: "preview", status: "pending" });
  // Saving the same words again does nothing.
  await me.mutation(api.feed.editWords, { conceptId, slots: { hook_text: "Watch churn reasons appear in one screen" } });
  expect((await t.run((ctx) => ctx.db.query("renderJobs").collect())).filter((j) => j.conceptId === conceptId)).toHaveLength(1);
});

test("edits are refused: someone else's pick, unknown slots, empty or over-long text, a kept pick", async () => {
  const { t, me, other, conceptId } = await withPick();
  await expect(other.mutation(api.feed.editWords, { conceptId, slots: { hook_text: "mine now" } })).rejects.toThrow(/not your concept/);
  await expect(me.mutation(api.feed.editWords, { conceptId, slots: { secret: "x" } })).rejects.toThrow(/isn't part of this pick/);
  await expect(me.mutation(api.feed.editWords, { conceptId, slots: { hook_text: "   " } })).rejects.toThrow(/can't be empty/);
  await expect(me.mutation(api.feed.editWords, { conceptId, slots: { hook_text: "x".repeat(81) } })).rejects.toThrow(/limit is 80/);
  await expect(me.mutation(api.feed.editWords, { conceptId, slots: { vo_script: "x".repeat(361) } })).rejects.toThrow(/limit is 360/);
  await t.run((ctx) => ctx.db.patch("concepts", conceptId, { status: "render_queued" }));
  await expect(me.mutation(api.feed.editWords, { conceptId, slots: { hook_text: "late" } })).rejects.toThrow(/haven't kept/);
  const c = await t.run((ctx) => ctx.db.get("concepts", conceptId));
  expect(c!.slots.hook_text).toBe("My churn dropped 87% in a week");
});

test("a redrawn preview that lands after a keep never un-keeps the pick", async () => {
  const { t, me, conceptId } = await withPick();
  process.env.WORKER_TOKEN = "wt";
  await me.mutation(api.feed.editWords, { conceptId, slots: { hook_text: "New headline" } });
  const job = await t.run(async (ctx) => (await ctx.db.query("renderJobs").collect()).find((j) => j.conceptId === conceptId)!);
  await t.run((ctx) => ctx.db.patch("concepts", conceptId, { status: "render_queued" })); // kept meanwhile
  const newThumb = await t.run((ctx) => ctx.storage.store(new Blob(["png2"])));
  await t.mutation(api.worker.completeJob, { token: "wt", jobId: job._id, previewThumbId: newThumb, costCents: 0 });
  const c = await t.run((ctx) => ctx.db.get("concepts", conceptId));
  expect(c!.status).toBe("render_queued");
  expect(c!.previewThumbId).toBe(newThumb);
  delete process.env.WORKER_TOKEN;
});

test("the user corrects the brief: trimmed, capped, version bumped, own brand only", async () => {
  const { t, s, me, other } = await withPick();
  const args = {
    brandId: s.brandId, name: " Instiora ", oneLiner: "School app parents open", audience: ["principals", " ", "parents"],
    tone: ["warm"], facts: ["Used by 40 schools", ...Array.from({ length: 20 }, (_, i) => `fact ${i}`)], trendNiche: "solo-saas",
  };
  await expect(other.mutation(api.brands.updateBrief, args)).rejects.toThrow(/not your brand/);
  await me.mutation(api.brands.updateBrief, args);
  const b = await t.run((ctx) => ctx.db.get("brands", s.brandId));
  expect(b).toMatchObject({ name: "Instiora", audience: ["principals", "parents"], trendNiche: "solo-saas", briefVersion: 2 });
  expect(b!.facts).toHaveLength(12);
  expect(b!.facts![0]).toBe("Used by 40 schools");
  // The space must exist in the library ("none" always may).
  await expect(me.mutation(api.brands.updateBrief, { ...args, trendNiche: "made-up" })).rejects.toThrow(/unknown trend space/);
  await me.mutation(api.brands.updateBrief, { ...args, trendNiche: "none" });
  await expect(me.mutation(api.brands.updateBrief, { ...args, audience: [] })).rejects.toThrow(/at least one audience/);
  const brief = await me.query(api.brands.myBrief, {});
  expect(brief).toMatchObject({ name: "Instiora", trendNiche: "none" });
  const niches = await me.query(api.brands.libraryNiches, {});
  expect(niches.find((n) => n.slug === "solo-saas")!.count).toBe(2);
});

test("deleting the account removes the phone captures too", async () => {
  const { t, s, me } = await withPick();
  const shot = await t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob(["page"]));
    await ctx.db.patch("brands", s.brandId, { pageShotIds: [id] });
    return id;
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  await me.mutation(api.account.purgeMine, { confirm: "DELETE" });
  await t.finishAllScheduledFunctions(() => {});
  vi.unstubAllGlobals();
  expect(await t.run((ctx) => ctx.storage.getUrl(shot))).toBeNull();
});
