import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { addMonths, currentPeriod, meter, planCharge, planRefund } from "../../convex/allowance";
import { signForTest, verifyStripeSignature, formEncode } from "../../convex/stripeApi";
import { CLERK_ID, OTHER_CLERK_ID, harness, seed } from "./setup";
import type { Id } from "../../convex/_generated/dataModel";

const SECRET = "whsec_test_secret";
const DAY = 86_400_000;

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
});
afterEach(() => vi.unstubAllGlobals());

/** Seed a user whose concept is waiting in Picks, with a given plan. */
async function seedPicks(t: ReturnType<typeof harness>, patch: Record<string, unknown> = {}) {
  const s = await seed(t);
  await t.run(async (ctx) => {
    await ctx.db.patch("concepts", s.conceptId, { status: "preview_ready", videoId: undefined });
    await ctx.db.patch("users", s.userId, patch as any);
  });
  return s;
}

async function webhook(t: ReturnType<typeof harness>, event: object, opts: { secret?: string; tSec?: number } = {}) {
  const body = JSON.stringify(event);
  const sig = await signForTest(body, opts.secret ?? SECRET, opts.tSec ?? Math.floor(Date.now() / 1000));
  return await t.fetch("/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": sig } });
}

describe("allowance arithmetic", () => {
  test("months clamp to the last day and periods roll from the anchor", () => {
    const jan31 = Date.UTC(2026, 0, 31, 10);
    expect(new Date(addMonths(jan31, 1)).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addMonths(jan31, 2)).toISOString().slice(0, 10)).toBe("2026-03-31"); // no drift after February
    const p = currentPeriod(jan31, Date.UTC(2026, 2, 15));
    expect(new Date(p.start).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(p.end).toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  test("Free is three videos, once", () => {
    const u = { plan: "free", videosUsedThisPeriod: 2 } as any;
    expect(meter(u, Date.now()).remaining).toBe(1);
    const c = planCharge(u, Date.now());
    expect(c.ok && c.from).toBe("free");
    expect(planCharge({ ...u, videosUsedThisPeriod: 3 }, Date.now())).toEqual({ ok: false, reason: "free_used" });
  });

  test("a paid month resets on its own and top-ups are used after the monthly allowance", () => {
    const anchor = Date.UTC(2026, 8, 1);
    const now = Date.UTC(2026, 8, 20);
    const full = { plan: "active", tier: "solo", term: "monthly", periodAnchorAt: anchor, periodStartsAt: anchor, videosUsedThisPeriod: 20, topupVideos: 2 } as any;
    const c = planCharge(full, now);
    expect(c.ok && c.from).toBe("topup");
    expect(c.ok && c.patch.topupVideos).toBe(1);
    expect(planCharge({ ...full, topupVideos: 0 }, now)).toEqual({ ok: false, reason: "month_used" });
    // Next month the 20 are back without anything having run.
    const nextMonth = Date.UTC(2026, 9, 2);
    expect(meter({ ...full, topupVideos: 0 }, nextMonth).remaining).toBe(20);
  });

  test("Founding access ends after three years", () => {
    const u = { plan: "active", tier: "studio", term: "threeYear", accessEndsAt: Date.now() - 1, videosUsedThisPeriod: 0 } as any;
    expect(meter(u, Date.now()).standing).toBe("lapsed");
    expect(planCharge(u, Date.now())).toEqual({ ok: false, reason: "no_plan" });
  });

  test("a refund returns the video to where it came from, but not to a month that already reset", () => {
    const anchor = Date.UTC(2026, 8, 1);
    const u = { plan: "active", tier: "solo", term: "monthly", periodAnchorAt: anchor, periodStartsAt: anchor, videosUsedThisPeriod: 5, topupVideos: 0 } as any;
    expect(planRefund(u, "topup", anchor, Date.UTC(2026, 8, 3))).toEqual({ topupVideos: 1 });
    expect(planRefund(u, "plan", anchor, Date.UTC(2026, 8, 3))?.videosUsedThisPeriod).toBe(4);
    expect(planRefund(u, "plan", anchor, Date.UTC(2026, 9, 3))).toBeNull();
  });
});

describe("the keep is the billable moment", () => {
  test("a keep charges one video and records where it came from", async () => {
    const t = harness();
    const s = await seedPicks(t);
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.feed.swipe, { conceptId: s.conceptId, keep: true });
    const { user, concept } = await t.run(async (ctx) => ({ user: await ctx.db.get("users", s.userId), concept: await ctx.db.get("concepts", s.conceptId) }));
    expect(user?.videosUsedThisPeriod).toBe(1);
    expect(concept?.billedFrom).toBe("free");
    expect(concept?.status).toBe("render_queued");
  });

  test("at zero the keep is refused, nothing renders, and skipping still works", async () => {
    const t = harness();
    const s = await seedPicks(t, { videosUsedThisPeriod: 3 });
    const me = t.withIdentity({ subject: CLERK_ID });
    await expect(me.mutation(api.feed.swipe, { conceptId: s.conceptId, keep: true })).rejects.toThrow(/ALLOWANCE\|free_used/);
    const jobs = await t.run(async (ctx) => await ctx.db.query("renderJobs").collect());
    expect(jobs.filter((j) => j.kind === "final")).toHaveLength(0);
    await me.mutation(api.feed.swipe, { conceptId: s.conceptId, keep: false });
    expect((await t.run(async (ctx) => await ctx.db.get("concepts", s.conceptId)))?.status).toBe("skipped");
  });

  test("a final render that fails for good gives the video back", async () => {
    const t = harness();
    const s = await seedPicks(t);
    process.env.WORKER_TOKEN = "wt";
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.feed.swipe, { conceptId: s.conceptId, keep: true });
    const job = (await t.run(async (ctx) => await ctx.db.query("renderJobs").collect())).find((j) => j.kind === "final")!;
    await t.run(async (ctx) => { await ctx.db.patch("renderJobs", job._id, { attempts: 99 }); });
    await t.mutation(api.worker.failJob, { token: "wt", jobId: job._id, error: "ffmpeg died" });
    const user = await t.run(async (ctx) => await ctx.db.get("users", s.userId));
    expect(user?.videosUsedThisPeriod).toBe(0);
  });

  test("an 'also in' variant is charged at request and refunded if the request fails", async () => {
    const t = harness();
    const s = await seed(t); // rendered concept
    process.env.WORKER_TOKEN = "wt";
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.feed.requestVariant, { conceptId: s.conceptId, language: "hi", languageStyle: "code-mixed" });
    const req = (await t.run(async (ctx) => await ctx.db.query("pipelineRequests").collect()))[0];
    expect(req.billedFrom).toBe("free");
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.videosUsedThisPeriod).toBe(1);
    await t.mutation(api.worker.failPipelineRequest, { token: "wt", requestId: req._id, error: "slot-fill failed" });
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.videosUsedThisPeriod).toBe(0);
  });
});

describe("webhook", () => {
  test("signatures: good passes, tampered, wrong-secret and stale fail", async () => {
    const body = '{"id":"evt_1"}';
    const now = Math.floor(Date.now() / 1000);
    const header = await signForTest(body, SECRET, now);
    expect(await verifyStripeSignature(body, header, SECRET)).toBe(true);
    expect(await verifyStripeSignature(body + " ", header, SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, await signForTest(body, "whsec_other", now), SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, await signForTest(body, SECRET, now - 3600), SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, null, SECRET)).toBe(false);
  });

  test("an unsigned request changes nothing", async () => {
    const t = harness();
    const s = await seed(t);
    const resp = await webhook(t, founding("evt_bad", s.userId, "cus_1"), { secret: "whsec_wrong" });
    expect(resp.status).toBe(400);
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.plan).toBe("free");
  });

  test("Founding 200: first buyer gets #1, three years of Studio, and the counter drops — once, even if Stripe retries", async () => {
    const t = harness();
    const s = await seed(t);
    const ev = founding("evt_f1", s.userId, "cus_1");
    expect((await webhook(t, ev)).status).toBe(200);
    expect((await webhook(t, ev)).status).toBe(200); // retry
    const user = await t.run(async (ctx) => await ctx.db.get("users", s.userId));
    expect(user?.plan).toBe("active");
    expect(user?.term).toBe("threeYear");
    expect(user?.tier).toBe("studio");
    expect(user?.foundingNumber).toBe(1);
    expect(user?.stripeCustomerId).toBe("cus_1");
    expect((user!.accessEndsAt! - Date.now()) / DAY).toBeGreaterThan(3 * 365 - 5);
    expect(await t.query(api.billing.foundingSpotsLeft, {})).toEqual({ cap: 200, left: 199 });
  });

  test("top-up adds ten videos once", async () => {
    const t = harness();
    const s = await seed(t);
    const ev = { id: "evt_t1", type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "paid", customer: "cus_1", client_reference_id: s.userId, metadata: { userId: s.userId, lookupKey: "topup_10" }, created: Math.floor(Date.now() / 1000) } } };
    await webhook(t, ev);
    await webhook(t, ev);
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.topupVideos).toBe(10);
  });

  test("subscription lifecycle: start, switch keeps the month's count, payment failure flags, cancel ends it", async () => {
    const t = harness();
    const s = await seed(t);
    await webhook(t, sub("evt_s1", "customer.subscription.created", s.userId, "active", "solo_monthly"));
    let user = await t.run(async (ctx) => await ctx.db.get("users", s.userId));
    expect([user?.plan, user?.tier, user?.term, user?.videosUsedThisPeriod]).toEqual(["active", "solo", "monthly", 0]);
    await t.run(async (ctx) => { await ctx.db.patch("users", s.userId, { videosUsedThisPeriod: 7 }); });

    await webhook(t, sub("evt_s2", "customer.subscription.updated", s.userId, "active", "studio_monthly"));
    user = await t.run(async (ctx) => await ctx.db.get("users", s.userId));
    expect([user?.tier, user?.videosUsedThisPeriod]).toEqual(["studio", 7]);

    await webhook(t, { id: "evt_i1", type: "invoice.payment_failed", data: { object: { customer: "cus_sub" } } });
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.paymentFailedAt).toBeTypeOf("number");
    await webhook(t, { id: "evt_i2", type: "invoice.paid", data: { object: { customer: "cus_sub" } } });
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.paymentFailedAt).toBeUndefined();

    await webhook(t, sub("evt_s3", "customer.subscription.deleted", s.userId, "canceled", "studio_monthly"));
    user = await t.run(async (ctx) => await ctx.db.get("users", s.userId));
    expect(user?.plan).toBe("canceled");
    expect(meter(user!, Date.now()).remaining).toBe(0);
  });
});

describe("checkout guards", () => {
  test("Free users can't buy a top-up; paid users can't buy a second plan", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    vi.stubGlobal("fetch", vi.fn());
    await expect(me.action(api.billing.startCheckout, { lookupKey: "topup_10" })).rejects.toThrow(/topup_needs_plan/);
    await t.run(async (ctx) => { await ctx.db.patch("users", s.userId, { plan: "active", tier: "solo", term: "monthly" }); });
    await expect(me.action(api.billing.startCheckout, { lookupKey: "studio_monthly" })).rejects.toThrow(/has_plan/);
    await expect(me.action(api.billing.startCheckout, { lookupKey: "nope" })).rejects.toThrow(/unknown/);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("Founding checkout is refused once all 200 spots are taken", async () => {
    const t = harness();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 1; i <= 200; i++) {
        await ctx.db.insert("users", { clerkId: `f${i}`, email: "", plan: "active", credits: 0, videosUsedThisPeriod: 0, timezone: "UTC", foundingNumber: i });
      }
    });
    vi.stubGlobal("fetch", vi.fn());
    await expect(t.withIdentity({ subject: CLERK_ID }).action(api.billing.startCheckout, { lookupKey: "solo_founding_3y" })).rejects.toThrow(/founding_full/);
    expect(await t.query(api.billing.foundingSpotsLeft, {})).toEqual({ cap: 200, left: 0 });
  });

  test("a subscription checkout asks Stripe for the price by lookup key and tags the user", async () => {
    const t = harness();
    await seed(t);
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.includes("/prices")) return new Response(JSON.stringify({ data: [{ id: "price_solo_m" }] }));
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
    }));
    const out = await t.withIdentity({ subject: CLERK_ID }).action(api.billing.startCheckout, { lookupKey: "solo_monthly" });
    expect(out.url).toContain("checkout.stripe.com");
    expect(calls[0].url).toContain("lookup_keys%5B0%5D=solo_monthly");
    const body = decodeURIComponent(calls[1].body!);
    expect(body).toContain("mode=subscription");
    expect(body).toContain("line_items[0][price]=price_solo_m");
    expect(body).toContain("subscription_data[metadata][lookupKey]=solo_monthly");
    expect(body).toContain("customer_email=owner@example.com");
    expect(body).toContain("success_url=https://manfriday.app/settings?checkout=success#s-plan");
  });

  test("form encoding matches Stripe's bracket style", () => {
    expect(decodeURIComponent(formEncode({ a: { b: 1 }, items: [{ price: "p" }], k: ["x"] }))).toBe("a[b]=1&items[0][price]=p&k[0]=x");
  });
});

describe("pause", () => {
  test("pausing moves the next charge out, holds posting, and resuming releases the queue", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("users", s.userId, { plan: "active", tier: "solo", term: "monthly", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" });
    });
    const periodEnd = Math.floor(Date.now() / 1000) + 10 * 86400;
    const posted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") posted.push(decodeURIComponent(String(init.body)));
      return new Response(JSON.stringify({ id: "sub_1", items: { data: [{ current_period_end: periodEnd }] } }));
    }));
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.action(api.billing.pausePlan, { days: 3 });
    expect(posted[0]).toContain(`trial_end=${periodEnd + 3 * 86400}`);
    expect(posted[0]).toContain("proration_behavior=none");

    // A post due now is held until the pause ends.
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() - 1000 });
    const pub = (await t.run(async (ctx) => await ctx.db.query("publications").collect()))[0];
    expect(await t.mutation(internal.publishing.markPublishing, { publicationId: pub._id })).toBeNull();
    let held = await t.run(async (ctx) => await ctx.db.get("publications", pub._id));
    expect(held?.status).toBe("queued");
    expect(held?.lastError).toBe("PAUSED_HELD");
    expect(held!.publishAt).toBeGreaterThan(Date.now() + 2 * DAY);

    // A second pause inside 30 days is refused.
    await expect(me.action(api.billing.pausePlan, { days: 1 })).rejects.toThrow(/already_paused/);

    await me.mutation(api.billing.resumePlan, {});
    held = await t.run(async (ctx) => await ctx.db.get("publications", pub._id));
    expect(held!.publishAt).toBeLessThanOrEqual(Date.now());
    expect(held?.lastError).toBeUndefined();
    await expect(me.action(api.billing.pausePlan, { days: 1 })).rejects.toThrow(/pause_cooldown/);
  });

  test("a Founding pause adds the days to the three-year term", async () => {
    const t = harness();
    const s = await seed(t);
    const ends = Date.now() + 1000 * DAY;
    await t.run(async (ctx) => { await ctx.db.patch("users", s.userId, { plan: "active", tier: "studio", term: "threeYear", accessEndsAt: ends }); });
    vi.stubGlobal("fetch", vi.fn());
    await t.withIdentity({ subject: CLERK_ID }).action(api.billing.pausePlan, { days: 2 });
    const user = await t.run(async (ctx) => await ctx.db.get("users", s.userId));
    expect(user!.accessEndsAt! - ends).toBe(2 * DAY);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function founding(id: string, userId: Id<"users">, customer: string) {
  return { id, type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "paid", customer, client_reference_id: userId, metadata: { userId, lookupKey: "studio_founding_3y" }, created: Math.floor(Date.now() / 1000) } } };
}

function sub(id: string, type: string, userId: Id<"users">, status: string, lookupKey: string) {
  return { id, type, data: { object: { id: "sub_1", customer: "cus_sub", status, metadata: { userId }, items: { data: [{ price: { lookup_key: lookupKey } }] } } } };
}

describe("account deletion and billing", () => {
  test("deleting an account schedules an immediate Stripe cancellation", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("users", s.userId, { plan: "active", tier: "solo", term: "monthly", stripeSubscriptionId: "sub_del", stripeCustomerId: "cus_del" });
    });
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.account.purgeMine, { confirm: "DELETE" });
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    const cancel = scheduled.find((f) => f.name.includes("cancelSubscriptionNow"));
    expect(cancel?.args[0]).toEqual({ subscriptionId: "sub_del" });
  });
});

describe("super user", () => {
  test("a team account keeps without being charged or refused, and checkout rules still follow the real plan", async () => {
    const t = harness();
    const s = await seedPicks(t, { videosUsedThisPeriod: 3, superUser: true });
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.feed.swipe, { conceptId: s.conceptId, keep: true });
    const user = await t.run(async (ctx) => await ctx.db.get("users", s.userId));
    expect(user?.videosUsedThisPeriod).toBe(3);
    const b = await me.query(api.billing.myBilling, {});
    expect(b?.unlimited).toBe(true);
    expect(b?.standing).toBe("free");
    vi.stubGlobal("fetch", vi.fn());
    await expect(me.action(api.billing.startCheckout, { lookupKey: "topup_10" })).rejects.toThrow(/topup_needs_plan/);
  });

  test("only the internal admin function can grant it", async () => {
    const t = harness();
    const s = await seed(t);
    await t.mutation(internal.admin.setSuperUser, { email: "OWNER@example.com", on: true });
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.superUser).toBe(true);
    await t.mutation(internal.admin.setSuperUser, { email: "owner@example.com", on: false });
    expect((await t.run(async (ctx) => await ctx.db.get("users", s.userId)))?.superUser).toBeUndefined();
    expect(Object.keys((api as any).admin ?? {})).toHaveLength(0);
  });
});

describe("pilot: tester grants, feedback and alerts", () => {
  test("a grant replaces the 3 free videos and the meter reflects it", async () => {
    const t = harness();
    const s = await seedPicks(t);
    await t.mutation(internal.admin.setVideoGrant, { email: "owner@example.com", videos: 25 });
    const me = t.withIdentity({ subject: CLERK_ID });
    const before = await me.query(api.billing.myBilling, {});
    expect(before?.limit).toBe(25);
    expect(before?.remaining).toBe(25);
    await me.mutation(api.feed.swipe, { conceptId: s.conceptId, keep: true });
    const after = await me.query(api.billing.myBilling, {});
    expect(after?.remaining).toBe(24);
    // Clearing the grant returns the account to the standard free allowance.
    await t.mutation(internal.admin.setVideoGrant, { email: "owner@example.com", videos: 0 });
    expect((await me.query(api.billing.myBilling, {}))?.limit).toBe(3);
  });

  test("a render that fails for good raises an alert naming the user", async () => {
    const t = harness();
    const s = await seedPicks(t);
    process.env.WORKER_TOKEN = "wt";
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.feed.swipe, { conceptId: s.conceptId, keep: true });
    const job = (await t.run(async (ctx) => await ctx.db.query("renderJobs").collect())).find((j) => j.kind === "final")!;
    await t.run(async (ctx) => { await ctx.db.patch("renderJobs", job._id, { attempts: 99 }); });
    await t.mutation(api.worker.failJob, { token: "wt", jobId: job._id, error: "ffmpeg died" });
    await t.finishAllScheduledFunctions(() => {});
    const alerts = await t.run(async (ctx) => await ctx.db.query("alerts").collect());
    const render = alerts.find((a) => a.kind === "render_failed");
    expect(render?.userEmail).toBe("owner@example.com");
    expect(render?.message).toMatch(/ffmpeg died/);
  });

  test("feedback is stored, raises an alert, and refuses empty messages", async () => {
    const t = harness();
    await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID, email: "owner@example.com" });
    await expect(me.mutation(api.feedback.submit, { message: " ", page: "/picks" })).rejects.toThrow(/empty/);
    await me.mutation(api.feedback.submit, { message: "The Telugu video had no sound", page: "/picks" });
    await t.finishAllScheduledFunctions(() => {});
    const rows = await t.run(async (ctx) => await ctx.db.query("feedback").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].page).toBe("/picks");
    const alerts = await t.run(async (ctx) => await ctx.db.query("alerts").collect());
    expect(alerts.some((a) => a.kind === "feedback" && a.message.includes("no sound"))).toBe(true);
  });

  test("the operator screen is refused to a normal account", async () => {
    const t = harness();
    await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    expect(await me.query(api.admin.amIAdmin, {})).toBe(false);
    expect(await me.query(api.admin.operatorView, {})).toBeNull();
    await t.mutation(internal.admin.setSuperUser, { email: "owner@example.com", on: true });
    expect(await me.query(api.admin.amIAdmin, {})).toBe(true);
    expect((await me.query(api.admin.operatorView, {}))?.testers.length).toBe(1);
  });
});

describe("product email", () => {
  test("welcome goes out once on account creation, never twice", async () => {
    const t = harness();
    const me = t.withIdentity({ subject: "user_new", email: "new@example.com" });
    await me.mutation(api.users.ensureCurrent, { timezone: "UTC" });
    await me.mutation(api.users.ensureCurrent, { timezone: "UTC" }); // second sign-in
    await t.finishAllScheduledFunctions(() => {});
    const user = (await t.run(async (ctx) => await ctx.db.query("users").collect())).find((u) => u.email === "new@example.com")!;
    expect(user.welcomeEmailedAt).toBeTypeOf("number");
  });

  test("a post that goes out emails once, and says 'draft' for TikTok", async () => {
    const t = harness();
    const s = await seed(t);
    const me = t.withIdentity({ subject: CLERK_ID });
    await me.mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 1000 });
    const pub = (await t.run(async (ctx) => await ctx.db.query("publications").collect()))[0];
    await t.mutation(internal.publishing.finishPublish, { publicationId: pub._id, outcome: "live", platformPostId: "abc" });
    await t.mutation(internal.publishing.finishPublish, { publicationId: pub._id, outcome: "live", platformPostId: "abc" });
    await t.finishAllScheduledFunctions(() => {});
    const post = (await t.run(async (ctx) => await ctx.db.query("posts").collect()))[0];
    expect(post.liveEmailedAt).toBeTypeOf("number"); // set once; the second call is a no-op
  });

  test("unsubscribe stops email, and a bad token changes nothing", async () => {
    const t = harness();
    const s = await seed(t);
    const token = await t.mutation(internal.email.ensureToken, { userId: s.userId });
    expect(await t.mutation(api.email.unsubscribe, { token: "not-a-real-token" })).toBe(false);
    expect(await t.mutation(api.email.unsubscribe, { token: token! })).toBe(true);
    expect(await t.query(internal.email.recipient, { userId: s.userId })).toBeNull(); // nothing more is sent
  });

  test("the weekly digest skips anyone who posted nothing", async () => {
    const t = harness();
    const s = await seed(t);
    expect(await t.mutation(internal.email.weeklyDigest, {})).toEqual({ sent: 0 });
    await t.run(async (ctx) => {
      await ctx.db.insert("posts", { userId: s.userId, conceptId: s.conceptId, publishAt: Date.now() - 1000, captionByPlatform: {} });
    });
    expect(await t.mutation(internal.email.weeklyDigest, {})).toEqual({ sent: 1 });
  });
});

describe("keep it and it's on your calendar", () => {
  /** Rendered concept + a connected account, as if the worker had just finished. */
  async function readyToSchedule(t: ReturnType<typeof harness>, patch: Record<string, unknown> = {}) {
    const s = await seed(t);
    await t.run(async (ctx) => { await ctx.db.patch("users", s.userId, { timezone: "Asia/Kolkata", ...(patch as any) }); });
    return s;
  }

  test("a finished final render books its own slot at 17:30 local", async () => {
    const t = harness();
    const s = await readyToSchedule(t);
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    const posts = await t.run(async (ctx) => await ctx.db.query("posts").collect());
    expect(posts).toHaveLength(1);
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour12: false, timeStyle: "short" }).format(new Date(posts[0].publishAt));
    expect(local).toBe("17:30");
    expect(posts[0].publishAt).toBeGreaterThan(Date.now());
  });

  test("it never double-books the same video", async () => {
    const t = harness();
    const s = await readyToSchedule(t);
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    expect((await t.run(async (ctx) => await ctx.db.query("posts").collect()))).toHaveLength(1);
  });

  test("turning the preference off leaves the video for the user to schedule", async () => {
    const t = harness();
    const s = await readyToSchedule(t, { autoSchedule: false });
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    expect((await t.run(async (ctx) => await ctx.db.query("posts").collect()))).toHaveLength(0);
  });

  test("no connected account means nothing is scheduled, and nothing throws", async () => {
    const t = harness();
    const s = await readyToSchedule(t);
    await t.run(async (ctx) => { await ctx.db.delete("socialAccounts", s.youtube); });
    await expect(t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId })).resolves.toBeNull();
    expect((await t.run(async (ctx) => await ctx.db.query("posts").collect()))).toHaveLength(0);
  });

  test("a second video that day goes to the next day, not the same minute", async () => {
    const t = harness();
    const s = await readyToSchedule(t);
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    const secondId = await t.run(async (ctx) => {
      const first = (await ctx.db.get("concepts", s.conceptId))!;
      const videoId = await ctx.storage.store(new Blob(["mp4"], { type: "video/mp4" }));
      return await ctx.db.insert("concepts", {
        userId: first.userId, brandId: first.brandId, templateId: first.templateId,
        briefVersion: 1, specVersion: 1, language: "en", status: "rendered",
        slots: { hook: "second video" }, videoId, batchId: "b1", costCents: 6,
      });
    });
    await t.mutation(internal.publishing.autoSchedule, { conceptId: secondId });
    const posts = await t.run(async (ctx) => await ctx.db.query("posts").collect());
    expect(posts).toHaveLength(2);
    const days = posts.map((p) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(p.publishAt)));
    expect(new Set(days).size).toBe(2); // one a day, not two at once
  });
});

describe("nothing posts without a yes", () => {
  test("an auto-scheduled post is NOT publishable until approved", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => { await ctx.db.patch("users", s.userId, { timezone: "UTC" }); });
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    const post = (await t.run(async (ctx) => await ctx.db.query("posts").collect()))[0];
    expect(post.approvedAt).toBeUndefined();

    // Even when its time arrives, the publisher refuses to pick it up.
    await t.run(async (ctx) => {
      await ctx.db.patch("posts", post._id, { publishAt: Date.now() - 1000 });
      for (const p of await ctx.db.query("publications").collect()) await ctx.db.patch("publications", p._id, { publishAt: Date.now() - 1000 });
    });
    expect(await t.query(internal.publishing.duePublications, { now: Date.now() })).toEqual([]);

    // And the per-publication path refuses too, even if something else queued it.
    const pub = (await t.run(async (ctx) => await ctx.db.query("publications").collect()))[0];
    expect(await t.mutation(internal.publishing.markPublishing, { publicationId: pub._id })).toBeNull();
    expect((await t.run(async (ctx) => await ctx.db.get("publications", pub._id)))?.status).toBe("queued");
  });

  test("approving releases it, and only the owner can approve", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("users", s.userId, { timezone: "UTC" });
      await ctx.db.insert("users", { clerkId: OTHER_CLERK_ID, email: "o@example.com", plan: "free", credits: 0, videosUsedThisPeriod: 0, timezone: "UTC" });
    });
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    const post = (await t.run(async (ctx) => await ctx.db.query("posts").collect()))[0];

    await expect(t.withIdentity({ subject: OTHER_CLERK_ID }).mutation(api.publishing.approvePost, { postId: post._id })).rejects.toThrow(/not your post/);
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.publishing.approvePost, { postId: post._id });
    await t.run(async (ctx) => {
      await ctx.db.patch("posts", post._id, { publishAt: Date.now() - 1000 });
      for (const p of await ctx.db.query("publications").collect()) await ctx.db.patch("publications", p._id, { publishAt: Date.now() - 1000 });
    });
    expect((await t.query(internal.publishing.duePublications, { now: Date.now() })).length).toBe(1);
  });

  test("pressing Schedule yourself counts as the confirmation", async () => {
    const t = harness();
    const s = await seed(t);
    await t.withIdentity({ subject: CLERK_ID }).mutation(api.publishing.schedulePost, { conceptId: s.conceptId, publishAt: Date.now() + 60_000 });
    const post = (await t.run(async (ctx) => await ctx.db.query("posts").collect()))[0];
    expect(post.approvedAt).toBeTypeOf("number");
  });

  test("approve all covers the pending ones, and an approval can be taken back", async () => {
    const t = harness();
    const s = await seed(t);
    await t.run(async (ctx) => { await ctx.db.patch("users", s.userId, { timezone: "UTC" }); });
    await t.mutation(internal.publishing.autoSchedule, { conceptId: s.conceptId });
    const me = t.withIdentity({ subject: CLERK_ID });
    expect(await me.mutation(api.publishing.approveAllPending, {})).toEqual({ approved: 1 });
    const post = (await t.run(async (ctx) => await ctx.db.query("posts").collect()))[0];
    await me.mutation(api.publishing.unapprovePost, { postId: post._id });
    expect((await t.run(async (ctx) => await ctx.db.get("posts", post._id)))?.approvedAt).toBeUndefined();
  });
});
