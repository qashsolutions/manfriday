import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { CLERK_ID, harness, seed } from "./setup";
import { GUEST } from "../../lib/site";

const DAY = 86_400_000;
const OPERATOR = "user_operator";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLERK_SECRET_KEY;
});

async function withOperator(t: ReturnType<typeof harness>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      clerkId: OPERATOR, email: "op@manfriday.app", plan: "free", credits: 0, videosUsedThisPeriod: 0, timezone: "UTC", superUser: true,
    });
  });
  return t.withIdentity({ subject: OPERATOR });
}

describe("guest invites", () => {
  test("only the team can reserve a guest slot", async () => {
    const t = harness();
    await seed(t); // a normal account
    await expect(t.withIdentity({ subject: CLERK_ID }).mutation(api.guests.reserve, { email: "a@b.co" })).rejects.toThrow(/not_allowed/);
  });

  test(`at most ${GUEST.cap}: the next one is refused, re-inviting doesn't use a slot, revoking frees one`, async () => {
    const t = harness();
    const op = await withOperator(t);
    for (let i = 0; i < GUEST.cap; i++) await op.mutation(api.guests.reserve, { email: `friend${i}@example.com` });
    await expect(op.mutation(api.guests.reserve, { email: "one-too-many@example.com" })).rejects.toThrow(/GUEST\|cap/);
    // Same email again: refreshed, not double-counted.
    await op.mutation(api.guests.reserve, { email: "Friend0@Example.com" });
    const s = await op.query(api.guests.summary, { now: Date.now() });
    expect(s?.used).toBe(GUEST.cap);
    await op.mutation(api.guests.release, { email: "friend3@example.com" });
    await op.mutation(api.guests.reserve, { email: "one-too-many@example.com" });
  });

  test("an email that already has an account is refused", async () => {
    const t = harness();
    const op = await withOperator(t);
    await seed(t);
    await expect(op.mutation(api.guests.reserve, { email: "owner@example.com" })).rejects.toThrow(/has_account/);
  });

  test("first sign-in starts the 21-day clock with 25 videos; live guests hold their slot", async () => {
    const t = harness();
    const op = await withOperator(t);
    await op.mutation(api.guests.reserve, { email: "venkat@example.com" });
    const before = Date.now();
    const guestId = await t.withIdentity({ subject: "user_guest", email: "venkat@example.com" }).mutation(api.users.ensureCurrent, {});
    const g = await t.run((ctx) => ctx.db.get("users", guestId));
    expect(g?.videoGrant).toBe(GUEST.videos);
    expect(g!.guestExpiresAt! - before).toBeGreaterThanOrEqual(GUEST.days * DAY);
    expect(g!.guestExpiresAt! - before).toBeLessThan(GUEST.days * DAY + 60_000);
    const s = await op.query(api.guests.summary, { now: Date.now() });
    expect(s).toMatchObject({ used: 1, invited: [], guests: [{ email: "venkat@example.com" }] });
    const billing = await t.withIdentity({ subject: "user_guest" }).query(api.billing.myBilling, {});
    expect(billing).toMatchObject({ limit: GUEST.videos, guestEndsAt: g!.guestExpiresAt });
  });

  test("a lapsed invite stops counting and is cleaned up", async () => {
    const t = harness();
    const op = await withOperator(t);
    await op.mutation(api.guests.reserve, { email: "late@example.com" });
    await t.run(async (ctx) => {
      const p = (await ctx.db.query("pendingGrants").first())!;
      await ctx.db.patch("pendingGrants", p._id, { expiresAt: Date.now() - 1 });
    });
    expect((await op.query(api.guests.summary, { now: Date.now() }))?.used).toBe(0);
    await t.mutation(internal.guests.expireDue, {});
    expect(await t.run((ctx) => ctx.db.query("pendingGrants").collect())).toHaveLength(0);
  });
});

describe("guest expiry", () => {
  test("an expired guest loses everything: tokens revoked, data and files deleted, then the sign-in", async () => {
    const t = harness();
    const s = await seed(t, { presenter: true });
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    await t.run(async (ctx) => {
      await ctx.db.patch("users", s.userId, { guestExpiresAt: Date.now() - 1000, videoGrant: 25 });
    });
    process.env.CLERK_SECRET_KEY = "sk_test_fake";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await t.mutation(internal.guests.expireDue, {})).toEqual({ deleted: 1 });
    await t.finishAllScheduledFunctions(() => {});

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
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toContain(`https://api.clerk.com/v1/users/${CLERK_ID}`);
    expect(urls.some((u) => u.includes("oauth2.googleapis.com/revoke"))).toBe(true);
  });

  test("a guest who bought a plan is never deleted — they stop being a guest", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("users", s.userId, { guestExpiresAt: Date.now() - 1000, plan: "active", tier: "solo", term: "monthly" });
    });
    expect(await t.mutation(internal.guests.expireDue, {})).toEqual({ deleted: 0 });
    const u = await t.run((ctx) => ctx.db.get("users", s.userId));
    expect(u?.guestExpiresAt).toBeUndefined();
  });

  test("a guest whose time isn't up is left alone", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => ctx.db.patch("users", s.userId, { guestExpiresAt: Date.now() + DAY }));
    expect(await t.mutation(internal.guests.expireDue, {})).toEqual({ deleted: 0 });
    expect(await t.run((ctx) => ctx.db.get("users", s.userId))).not.toBeNull();
  });
});

describe("connecting a social account while the account is being deleted", () => {
  test("starting a connect is refused once deletion has begun", async () => {
    const t = harness();
    const s = await seed(t);
    process.env.TIKTOK_CLIENT_KEY = "ck";
    process.env.GOOGLE_CLIENT_ID = "gid";
    await t.run((ctx) => ctx.db.patch("users", s.userId, { deletingAt: Date.now() }));
    const me = t.withIdentity({ subject: CLERK_ID });
    await expect(me.mutation(api.oauth.startTikTok, {})).rejects.toThrow(/being deleted/);
    await expect(me.mutation(api.oauth.startGoogle, {})).rejects.toThrow(/being deleted/);
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
  });

  test("a connect that finishes mid-deletion is not stored, and its tokens are revoked", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch("users", s.userId, { deletingAt: Date.now() }));
    const res = await t.mutation(internal.oauth.storeAccount, {
      userId: s.userId, platform: "tiktok", handle: "@late", accessToken: "act.late", refreshToken: "rft.late", expiresAt: Date.now() + 3600_000,
    });
    expect(res).toBeNull();
    const tiktok = await t.run((ctx) => ctx.db.query("socialAccounts").collect());
    expect(tiktok.filter((a) => a.platform === "tiktok")).toHaveLength(0);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((f) => f.name.includes("revokeAtProvider") && (f.args[0] as { accessToken: string }).accessToken === "act.late")).toBe(true);
  });

  test("the last batch sweeps social accounts again before the account row goes", async () => {
    const t = harness();
    const s = await seed(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.account.purgeMine, { confirm: "DELETE" });
    // Slips in after startPurge (e.g. written before the deletingAt check existed).
    await t.run((ctx) => ctx.db.insert("socialAccounts", {
      userId: s.userId, platform: "tiktok", handle: "@late", accessToken: "act.late", refreshToken: "rft.late", expiresAt: 0, status: "connected",
    }));
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run((ctx) => ctx.db.query("socialAccounts").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
  });
});
