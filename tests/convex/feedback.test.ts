import { describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { CLERK_ID, OTHER_CLERK_ID, harness, seed } from "./setup";

const device = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/131.0", viewport: "1440×900", timezone: "America/Chicago", language: "en-US" };

describe("Something wrong? reports carry their context", () => {
  test("the pick on screen, the last error and the device are stored, with pick facts read from the database", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID, email: "owner@example.com" });
    await me.mutation(api.feedback.submit, {
      message: "The video has no sound",
      page: "/picks",
      context: {
        item: { kind: "pick", id: s.conceptId, label: "Nobody told me" },
        lastError: { message: "Upload didn't complete", at: 1_700_000_000_000, page: "/settings" },
        device,
      },
    });
    const row = await t.run(async (ctx) => (await ctx.db.query("feedback").first())!);
    expect(row.context?.pick).toEqual({ id: s.conceptId, status: "rendered", format: "hook_video", language: "en", batchId: "b1", hasVideo: true });
    expect(row.context?.lastError?.message).toBe("Upload didn't complete");
    expect(row.context?.device).toEqual(device);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await t.finishAllScheduledFunctions(() => {});
    vi.unstubAllGlobals();
    const alert = await t.run(async (ctx) => (await ctx.db.query("alerts").first())!);
    expect(alert.message).toMatch(/Pick: .* hook_video · en · rendered · has video/);
    expect(alert.message).toMatch(/Last error shown: "Upload didn't complete" on \/settings/);
    expect(alert.message).toMatch(/Device: Mozilla.*1440×900/);
  });

  test("someone else's pick is never recorded, and a made-up id is ignored", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { clerkId: OTHER_CLERK_ID, email: "other@example.com", plan: "free", credits: 0, videosUsedThisPeriod: 0, timezone: "UTC" });
    });
    const other = t.withIdentity({ subject: OTHER_CLERK_ID, email: "other@example.com" });
    await other.mutation(api.feedback.submit, { message: "look at this", page: "/picks", context: { item: { kind: "pick", id: s.conceptId }, device } });
    await other.mutation(api.feedback.submit, { message: "and this", page: "/picks", context: { item: { kind: "pick", id: "not-an-id" } } });
    const rows = await t.run((ctx) => ctx.db.query("feedback").collect());
    expect(rows.map((r) => r.context?.pick)).toEqual([undefined, undefined]);
    expect(rows[1].context).toBeUndefined(); // nothing usable was sent
  });

  test("oversized fields are trimmed", async () => {
    const t = harness();
    await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID, email: "owner@example.com" });
    await me.mutation(api.feedback.submit, {
      message: "long",
      page: "/calendar",
      context: { lastError: { message: "x".repeat(5000), at: 1, page: "/p".repeat(500) }, device: { ...device, userAgent: "u".repeat(5000) } },
    });
    const row = await t.run(async (ctx) => (await ctx.db.query("feedback").first())!);
    expect(row.context?.lastError?.message).toHaveLength(500);
    expect(row.context?.lastError?.page).toHaveLength(120);
    expect(row.context?.device?.userAgent).toHaveLength(300);
  });

  test("a report without context still works as before", async () => {
    const t = harness();
    await seed(t);
    await t.withIdentity({ subject: CLERK_ID, email: "owner@example.com" }).mutation(api.feedback.submit, { message: "plain report", page: "/picks" });
    const row = await t.run(async (ctx) => (await ctx.db.query("feedback").first())!);
    expect(row.context).toBeUndefined();
  });

  test("deleting the account keeps the report but removes who sent it and their device", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID, email: "owner@example.com" });
    await me.mutation(api.feedback.submit, {
      message: "The video has no sound",
      page: "/picks",
      context: { item: { kind: "pick", id: s.conceptId }, lastError: { message: "boom", at: 1, page: "/picks" }, device },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await me.mutation(api.account.purgeMine, { confirm: "DELETE" });
    await t.finishAllScheduledFunctions(() => {});
    vi.unstubAllGlobals();
    const row = await t.run(async (ctx) => (await ctx.db.query("feedback").first())!);
    expect(row.message).toBe("The video has no sound");
    expect(row.email).toBe("");
    expect(row.userId).toBeUndefined();
    expect(row.context?.device).toBeUndefined();
    expect(row.context?.lastError?.message).toBe("boom");
  });
});
