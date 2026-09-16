import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { CLERK_ID, OTHER_CLERK_ID, harness, seed } from "./setup";

describe("schedulePost", () => {
  test("creates the post, one publication per connected account, and a tracked link in both captions", async () => {
    const t = harness();
    const s = await seed(t);
    const asUser = t.withIdentity({ subject: CLERK_ID });
    await asUser.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const { posts, pubs, links } = await t.run(async (ctx) => ({
      posts: await ctx.db.query("posts").collect(),
      pubs: await ctx.db.query("publications").collect(),
      links: await ctx.db.query("trackedLinks").collect(),
    }));
    expect(posts).toHaveLength(1);
    expect(pubs).toHaveLength(1);
    expect(pubs[0].platform).toBe("youtube");
    expect(pubs[0].idempotencyKey).toBe(pubs[0]._id);
    expect(links).toHaveLength(1);
    expect(links[0].targetUrl).toContain("utm_source=manfriday");
    const caps = posts[0].captionByPlatform as Record<string, string>;
    expect(caps.youtube).toContain(`https://manfriday.app/l/${links[0].slug}`);
    expect(caps.tiktok).toContain(`manfriday.app/l/${links[0].slug}`);
    expect(caps.youtube.startsWith("Nobody told me")).toBe(true);
  });

  test("refuses another user's concept and unrendered concepts", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { clerkId: OTHER_CLERK_ID, email: "o@example.com", plan: "free", credits: 0, videosUsedThisPeriod: 0, timezone: "UTC" });
    });
    const other = t.withIdentity({ subject: OTHER_CLERK_ID });
    await expect(other.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() })).rejects.toThrow(/not your concept/);
    await t.run(async (ctx) => { await ctx.db.patch("concepts", s.conceptId, { status: "kept" }); });
    const me = t.withIdentity({ subject: CLERK_ID });
    await expect(me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() })).rejects.toThrow(/rendered/);
  });

  test("slideshows never target YouTube (D1)", async () => {
    const t = harness();
    const s = await seed(t, { format: "slideshow" });
    const me = t.withIdentity({ subject: CLERK_ID });
    await expect(me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() })).rejects.toThrow(/connect a TikTok or YouTube/);
  });

  test("myQueue never exposes tokens and carries the short link", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const queue = await me.query(api.publishing.myQueue, {});
    expect(queue[0].link).toMatch(/^manfriday\.app\/l\/[a-z0-9]{7}$/);
    expect(JSON.stringify(queue)).not.toContain("secret");
  });
});

describe("feed", () => {
  test("myRendered excludes concepts that already have a post; discard refuses them", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    expect(await me.query(api.feed.myRendered, {})).toHaveLength(1);
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    expect(await me.query(api.feed.myRendered, {})).toHaveLength(0);
    await expect(me.mutation(api.feed.discard, { conceptId: s.conceptId })).rejects.toThrow(/already scheduled/);
  });

  test("discard marks the concept skipped and deletes its files", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.feed.discard, { conceptId: s.conceptId });
    const { concept, file } = await t.run(async (ctx) => ({
      concept: await ctx.db.get("concepts", s.conceptId),
      file: await ctx.storage.getUrl(s.videoId),
    }));
    expect(concept?.status).toBe("skipped");
    expect(concept?.videoId).toBeUndefined();
    expect(file).toBeNull();
  });
});
