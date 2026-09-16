import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { CLERK_ID, harness, seed } from "./setup";

describe("YouTube compliance promises", () => {
  test("myAccounts never returns token fields", async () => {
    const t = harness();
    await seed(t);
    const rows = await t.withIdentity({ subject: CLERK_ID }).query(api.oauth.myAccounts, {});
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["avatarUrl", "handle", "id", "platform", "status"]);
  });

  test("disconnect wipes both tokens, marks revoked, and schedules provider revoke + metrics purge", async () => {
    const t = harness();
    const s = await seed(t);
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.oauth.disconnect, { accountId: s.youtube });
    const acct = await t.run((ctx) => ctx.db.get("socialAccounts", s.youtube));
    expect(acct?.status).toBe("revoked");
    expect(acct?.accessToken).toBe("");
    expect(acct?.refreshToken).toBe("");
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const names = scheduled.map((f) => f.name);
    expect(names).toContain("oauth:revokeAtProvider");
    expect(names).toContain("stats:purgeMetricsForAccount");
  });

  test("markAuthExpired (refresh refused) wipes tokens too", async () => {
    const t = harness();
    const s = await seed(t);
    await t.mutation(internal.oauth.markAuthExpired, { accountId: s.youtube });
    const acct = await t.run((ctx) => ctx.db.get("socialAccounts", s.youtube));
    expect(acct?.status).toBe("expired");
    expect(acct?.accessToken).toBe("");
    expect(acct?.refreshToken).toBe("");
  });

  test("stats: snapshots older than 30 days are pruned; purge removes an account's metrics", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const pub = await t.run(async (ctx) => (await ctx.db.query("publications").first())!);
    await t.run(async (ctx) => {
      await ctx.db.insert("metrics", { publicationId: pub._id, capturedAt: Date.now() - 40 * 86_400_000, views: 1, likes: 0, comments: 0, shares: 0 });
      await ctx.db.insert("metrics", { publicationId: pub._id, capturedAt: Date.now() - 5 * 86_400_000, views: 2, likes: 0, comments: 0, shares: 0 });
    });
    await t.mutation(internal.stats.recordSnapshots, { snapshots: [{ publicationId: pub._id, views: 3, likes: 1, comments: 0 }] });
    let rows = await t.run((ctx) => ctx.db.query("metrics").collect());
    expect(rows.map((r) => r.views).sort()).toEqual([2, 3]); // the 40-day-old one is gone
    await t.mutation(internal.stats.purgeMetricsForAccount, { accountId: s.youtube });
    rows = await t.run((ctx) => ctx.db.query("metrics").collect());
    expect(rows).toHaveLength(0);
  });

  test("delete account purges every user-owned row and file", async () => {
    const t = harness();
    const s = await seed(t, { presenter: true });
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const counts = await me.mutation(api.account.purgeMine, { confirm: "DELETE" });
    expect(counts.users).toBe(1);
    expect(counts.socialAccounts).toBe(1);
    expect(counts.posts).toBe(1);
    expect(counts.trackedLinks).toBe(1);
    const left = await t.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      brands: await ctx.db.query("brands").collect(),
      concepts: await ctx.db.query("concepts").collect(),
      accounts: await ctx.db.query("socialAccounts").collect(),
      posts: await ctx.db.query("posts").collect(),
      pubs: await ctx.db.query("publications").collect(),
      links: await ctx.db.query("trackedLinks").collect(),
      video: await ctx.storage.getUrl(s.videoId),
    }));
    expect(Object.values(left).every((v) => (Array.isArray(v) ? v.length === 0 : v === null))).toBe(true);
  });
});

describe("tracked links", () => {
  test("click logs humans with the platform, skips crawlers, and unknown slugs return null", async () => {
    const t = harness();
    const s = await seed(t);
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const link = await t.run(async (ctx) => (await ctx.db.query("trackedLinks").first())!);
    const human = await t.mutation(api.links.click, { slug: link.slug, referrerPlatform: "youtube", count: true });
    expect(human?.targetUrl).toContain("example.com/app");
    const bot = await t.mutation(api.links.click, { slug: link.slug, referrerPlatform: "direct", count: false });
    expect(bot?.targetUrl).toBe(human?.targetUrl);
    expect(await t.mutation(api.links.click, { slug: "nope000", count: true })).toBeNull();
    const clicks = await t.run((ctx) => ctx.db.query("linkClicks").collect());
    expect(clicks).toHaveLength(1);
    expect(clicks[0].referrerPlatform).toBe("youtube");
  });
});

describe("presenter", () => {
  test("brandHasPresenter reflects the photo; setVoice is per-brand and owner-only", async () => {
    const t = harness();
    const s = await seed(t, { presenter: true });
    const me = t.withIdentity({ subject: CLERK_ID });
    expect((await me.query(api.brands.myBrand, {}))?.hasPresenter).toBe(true);
    expect((await me.query(api.brands.myBrand, {}))?.voice).toBe("female");
    await me.mutation(api.brands.setVoice, { brandId: s.brandId, voice: "male" });
    expect((await me.query(api.brands.myBrand, {}))?.voice).toBe("male");
    await me.mutation(api.brands.removePresenter, { brandId: s.brandId });
    expect((await me.query(api.brands.myBrand, {}))?.hasPresenter).toBe(false);
  });
});
