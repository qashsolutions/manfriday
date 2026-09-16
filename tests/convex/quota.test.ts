import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { UPLOAD_UNITS, nextQuotaDayStart, quotaDay, quotaDayBounds, quotaKey } from "../../convex/youtubeQuota";
import { CLERK_ID, harness, seed } from "./setup";

// Compliance rule 7: never schedule past the granted quota. The daily limit is
// shared by every user until the audit clears, so the gate must hold.

describe("quota arithmetic", () => {
  test("the quota day is Pacific, not UTC", () => {
    // 2026-03-02 04:00 UTC is still 1 Mar in Los Angeles.
    expect(quotaDay(Date.UTC(2026, 2, 2, 4, 0))).toBe("2026-03-01");
    expect(quotaKey(Date.UTC(2026, 2, 2, 4, 0))).toBe("youtube:2026-03-01");
  });

  test("day bounds cover exactly one day and survive the DST switch", () => {
    // US daylight saving starts 8 Mar 2026: that Pacific day is 23 hours long.
    const { start, end } = quotaDayBounds(Date.UTC(2026, 2, 8, 20, 0));
    expect(quotaDay(start)).toBe("2026-03-08");
    expect(quotaDay(start - 1)).toBe("2026-03-07");
    expect(quotaDay(end)).toBe("2026-03-09");
    expect(end - start).toBe(23 * 60 * 60 * 1000);
  });

  test("the next quota day starts after the current one ends", () => {
    const now = Date.UTC(2026, 5, 15, 12, 0); // 05:00 Pacific on 15 June
    expect(quotaDay(now)).toBe("2026-06-15");
    expect(nextQuotaDayStart(now)).toBeGreaterThan(quotaDayBounds(now).end);
    expect(quotaDay(nextQuotaDayStart(now))).toBe("2026-06-16");
  });
});

describe("schedulePost quota gate", () => {
  test("refuses a day whose uploads are spent and names the next open slot", async () => {
    const t = harness();
    const s = await seed(t);
    const when = Date.now() + 3 * 60 * 60 * 1000;
    // Burn the day: 10,000 units minus one upload's worth already used.
    await t.run(async (ctx) => {
      await ctx.db.insert("quotaCounters", { key: quotaKey(when), used: 10_000 - UPLOAD_UNITS + 1, limit: 10_000 });
    });
    const me = t.withIdentity({ subject: CLERK_ID });
    await expect(me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: when })).rejects.toThrow(/QUOTA_FULL/);
    const slot = await me.query(api.publishing.youtubeSlot, { publishAt: when });
    expect(slot?.ok).toBe(false);
    expect(slot?.nextOpenAt).toBeGreaterThan(when);
  });

  test("counts uploads already queued that day, not just units spent", async () => {
    const t = harness();
    const s = await seed(t);
    const when = Date.now() + 3 * 60 * 60 * 1000;
    // Six queued YouTube uploads = 9,600 units reserved; a seventh will not fit in 10,000.
    await t.run(async (ctx) => {
      const postId = await ctx.db.insert("posts", { userId: s.userId, conceptId: s.conceptId, publishAt: when, captionByPlatform: {} });
      for (let i = 0; i < 6; i++) {
        await ctx.db.insert("publications", {
          postId, accountId: s.youtube, platform: "youtube", status: "queued",
          publishAt: when, attempts: 0, idempotencyKey: `k${i}`,
        });
      }
    });
    const me = t.withIdentity({ subject: CLERK_ID });
    await expect(me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: when })).rejects.toThrow(/QUOTA_FULL/);
  });

  test("lets a normal schedule through and leaves room for the daily stats refresh", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const pubs = await t.run(async (ctx) => await ctx.db.query("publications").collect());
    expect(pubs).toHaveLength(1);
  });
});

describe("quota deferral", () => {
  test("a quota-exhausted upload waits for the next quota day instead of failing", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const pubId = (await t.run(async (ctx) => await ctx.db.query("publications").collect()))[0]._id;
    await t.run(async (ctx) => { await ctx.db.patch("publications", pubId, { attempts: 1 }); });
    await t.mutation(internal.publishing.finishPublish, {
      publicationId: pubId,
      outcome: "deferred",
      retryAt: nextQuotaDayStart(Date.now()),
      error: "quotaExceeded",
    });
    const pub = await t.run(async (ctx) => await ctx.db.get("publications", pubId));
    expect(pub?.status).toBe("queued");
    expect(pub?.publishAt).toBeGreaterThan(Date.now());
    expect(pub?.lastError).toMatch(/^QUOTA_DEFERRED/);
    // The queue tells the user it moved, without an error chip.
    const queue = await me.query(api.publishing.myQueue, {});
    expect(queue[0].publications[0].deferred).toBe(true);
    expect(queue[0].publications[0].status).toBe("queued");
  });

  test("stops deferring after five quota days and fails honestly", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const pubId = (await t.run(async (ctx) => await ctx.db.query("publications").collect()))[0]._id;
    await t.run(async (ctx) => { await ctx.db.patch("publications", pubId, { attempts: 6 }); });
    await t.mutation(internal.publishing.finishPublish, {
      publicationId: pubId, outcome: "deferred", retryAt: nextQuotaDayStart(Date.now()), error: "quotaExceeded",
    });
    const pub = await t.run(async (ctx) => await ctx.db.get("publications", pubId));
    expect(pub?.status).toBe("failed");
  });
});
