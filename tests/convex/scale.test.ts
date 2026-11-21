import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { PURGE_BATCH } from "../../convex/account";
import { CLERK_ID, harness, seed } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

/** What an account looks like after heavy use (21 Nov 2026 audit): several reads
 *  used to look only at a user's OLDEST 200 posts, so newer posts went missing. */

const DAY = 86_400_000;

/** n old, published-and-done posts, each with its own rendered concept. */
async function oldPosts(t: ReturnType<typeof harness>, s: Awaited<ReturnType<typeof seed>>, n: number) {
  await t.run(async (ctx) => {
    const src = (await ctx.db.get("concepts", s.conceptId))!;
    const { _id, _creationTime, ...rest } = src;
    for (let i = 0; i < n; i++) {
      const conceptId = await ctx.db.insert("concepts", { ...rest, batchId: `old-${i}`, videoId: undefined });
      await ctx.db.insert("posts", {
        userId: s.userId, conceptId, publishAt: Date.now() - (n - i + 2) * DAY, captionByPlatform: {}, approvedAt: 1,
      });
    }
  });
}

describe("past 200 posts", () => {
  test("Approve all reaches the newest post", async () => {
    const t = harness();
    const s = await seed(t);
    await oldPosts(t, s, 250);
    const me = t.withIdentity({ subject: CLERK_ID });
    await t.run(async (ctx) => {
      await ctx.db.insert("posts", { userId: s.userId, conceptId: s.conceptId, publishAt: Date.now() + DAY, captionByPlatform: {} });
    });
    expect(await me.mutation(api.publishing.approveAllPending, {})).toEqual({ approved: 1 });
  });

  test("a scheduled video never shows as ready again, and can't be deleted", async () => {
    const t = harness();
    const s = await seed(t);
    await oldPosts(t, s, 250);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + DAY });
    const ready = await me.query(api.feed.myRendered, {});
    expect(ready.map((r) => r.id)).not.toContain(s.conceptId);
    await expect(me.mutation(api.feed.discard, { conceptId: s.conceptId })).rejects.toThrow(/already scheduled/);
    await expect(me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 2 * DAY })).rejects.toThrow(/already scheduled/);
  });

  test("auto-schedule still keeps to one a day", async () => {
    const t = harness();
    const s = await seed(t);
    await oldPosts(t, s, 250);
    const me = t.withIdentity({ subject: CLERK_ID });
    // A post already booked tomorrow-ish: the auto slot must land on another day.
    const first = await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    expect(first).not.toBeNull();
    const second = await t.run(async (ctx) => {
      const src = (await ctx.db.get("concepts", s.conceptId))!;
      const { _id, _creationTime, ...rest } = src;
      return await ctx.db.insert("concepts", { ...rest, batchId: "new-2" });
    });
    await t.mutation(internal.publishing.autoSchedule, { conceptId: second });
    const queue = await me.query(api.publishing.myQueue, {});
    const days = queue.filter((q) => q.publishAt > Date.now()).map((q) => new Date(q.publishAt).toISOString().slice(0, 10));
    expect(new Set(days).size).toBe(days.length);
  });
});

describe("clicks", () => {
  test("Analytics counts every click, past the old cap of 1,000", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() - 60_000 });
    const link = await t.run(async (ctx) => (await ctx.db.query("trackedLinks").first())!);
    // 1,200 clicks logged before the counter existed…
    await t.run(async (ctx) => {
      for (let i = 0; i < 1200; i++) await ctx.db.insert("linkClicks", { linkId: link._id, clickedAt: Date.now() - i });
    });
    let rows = (await me.query(api.stats.myAnalytics, {}))!.rows;
    expect(rows[0].clicks).toBe(1200);
    // …then one more: the counter picks up the history and keeps going.
    await t.mutation(api.links.click, { slug: link.slug, referrerPlatform: "tiktok", count: true });
    rows = (await me.query(api.stats.myAnalytics, {}))!.rows;
    expect(rows[0].clicks).toBe(1201);
    expect((await t.run((ctx) => ctx.db.get("trackedLinks", link._id)))?.clickCount).toBe(1201);
  });
});

describe("deleting a big account", () => {
  test("runs in batches and leaves nothing behind", async () => {
    const t = harness();
    const s = await seed(t);
    await oldPosts(t, s, 120);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + DAY });
    const link = await t.run(async (ctx) => (await ctx.db.query("trackedLinks").first())!);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3 * PURGE_BATCH; i++) await ctx.db.insert("linkClicks", { linkId: link._id as Id<"trackedLinks">, clickedAt: i });
      for (let i = 0; i < 50; i++) await ctx.db.insert("renderJobs", { conceptId: s.conceptId, kind: "preview", status: "done", priority: 1, attempts: 1 });
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await me.mutation(api.account.purgeMine, { confirm: "DELETE" });
    await t.finishAllScheduledFunctions(() => {});
    vi.unstubAllGlobals();
    const left = await t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).length,
      posts: (await ctx.db.query("posts").collect()).length,
      concepts: (await ctx.db.query("concepts").collect()).length,
      clicks: (await ctx.db.query("linkClicks").collect()).length,
      jobs: (await ctx.db.query("renderJobs").collect()).length,
    }));
    expect(left).toEqual({ users: 0, posts: 0, concepts: 0, clicks: 0, jobs: 0 });
  });
});

describe("new picks", () => {
  test("progress for the newest batch is found however many picks came before", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => {
      const src = (await ctx.db.get("concepts", s.conceptId))!;
      const { _id, _creationTime, ...rest } = src;
      for (let i = 0; i < 320; i++) await ctx.db.insert("concepts", { ...rest, status: "skipped", batchId: `old-${i % 32}` });
      for (let i = 0; i < 10; i++) await ctx.db.insert("concepts", { ...rest, status: i < 4 ? "preview_ready" : "draft", batchId: "newest" });
      await ctx.db.insert("pipelineRequests", { userId: s.userId, url: "https://example.com/app", status: "drafting", brandId: s.brandId, batchId: "newest" });
    });
    const req = await t.withIdentity({ subject: CLERK_ID }).query(api.onboarding.myLatestRequest, {});
    expect(req?.previews).toEqual({ ready: 4, total: 10 });
  });
});
