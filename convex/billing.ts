/** Billing (M4): Stripe Checkout for plans, Founding 200 and top-ups; the Stripe
 *  billing portal for card/invoices/cancel/plan changes; pause; and the webhook
 *  handlers that are the ONLY writers of a user's plan.
 *
 *  Prices are fetched by lookup key (lib/billing-catalog.ts), so the same code
 *  runs in test and live mode. Card details never touch Man Friday — Checkout
 *  and the portal are Stripe-hosted pages.
 */
import { ConvexError, v } from "convex/values";
import { action, env, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { currentUserId } from "./users";
import { addMonths, meter, standing } from "./allowance";
import { stripeCall } from "./stripeApi";
import { FOUNDING, POLICY, TOPUP } from "../lib/site";
import { CATALOG } from "../lib/billing-catalog";

const DAY = 24 * 60 * 60 * 1000;
const PAUSE_COOLDOWN_DAYS = 30;
const APP_URL = () => env.APP_URL ?? "https://manfriday.app";

// ── lookup keys ────────────────────────────────────────────────────────────

export type Purchase =
  | { kind: "subscription"; tier: "solo" | "studio"; term: "monthly" | "quarterly" | "annual" }
  | { kind: "founding"; tier: "solo" | "studio" }
  | { kind: "topup" };

const KNOWN_KEYS = new Set(CATALOG.flatMap((c) => c.prices.map((p) => p.lookupKey)));

export function parseLookupKey(key: string | null | undefined): Purchase | null {
  if (!key || !KNOWN_KEYS.has(key)) return null;
  if (key.startsWith("topup_")) return { kind: "topup" };
  const [tier, ...rest] = key.split("_");
  if (tier !== "solo" && tier !== "studio") return null;
  const term = rest.join("_");
  if (term === "founding_3y") return { kind: "founding", tier };
  if (term === "monthly" || term === "quarterly" || term === "annual") return { kind: "subscription", tier, term };
  return null;
}

// ── reads ──────────────────────────────────────────────────────────────────

async function foundingTaken(ctx: QueryCtx | MutationCtx): Promise<number> {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_foundingNumber", (q) => q.gt("foundingNumber", 0))
    .take(FOUNDING.cap + 50);
  return rows.length;
}

/** Public: the live Founding 200 counter for the marketing pages. */
export const foundingSpotsLeft = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const taken = await foundingTaken(ctx);
    return { cap: FOUNDING.cap, left: Math.max(0, FOUNDING.cap - taken) };
  },
});

/** Everything the meter, Picks and Settings need about the signed-in user's plan. */
export const myBilling = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get("users", userId);
    if (!user) return null;
    const now = Date.now();
    const m = meter(user, now);
    const pausedUntil = user.pausedUntil && user.pausedUntil > now ? user.pausedUntil : null;
    const cooldownEnds = user.lastPauseStartedAt ? user.lastPauseStartedAt + PAUSE_COOLDOWN_DAYS * DAY : 0;
    return {
      ...m,
      tier: user.tier ?? null,
      term: user.term ?? null,
      foundingNumber: user.foundingNumber ?? null,
      accessEndsAt: user.accessEndsAt ?? null,
      cancelAt: user.cancelAt ?? null,
      paymentFailed: !!user.paymentFailedAt,
      pausedUntil,
      canPause: m.standing === "paid" && !pausedUntil && now >= cooldownEnds,
      pauseAvailableAt: m.standing === "paid" && now < cooldownEnds ? cooldownEnds : null,
      canManage: !!user.stripeCustomerId,
    };
  },
});

export const billingUser = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    return await ctx.db.query("users").withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId)).unique();
  },
});

async function requireUser(ctx: ActionCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("not signed in");
  const user: Doc<"users"> | null = await ctx.runQuery(internal.billing.billingUser, { clerkId: identity.subject });
  if (!user) throw new Error("not signed in");
  return user;
}

// ── checkout + portal ─────────────────────────────────────────────────────

/** Start a Stripe Checkout for a plan, the Founding 200 deal, or a top-up. Returns the hosted URL. */
export const startCheckout = action({
  args: { lookupKey: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<{ url: string }> => {
    const user = await requireUser(ctx);
    const purchase = parseLookupKey(args.lookupKey);
    if (!purchase) throw new ConvexError("PLAN|unknown|That plan doesn't exist.");
    const now = Date.now();
    const s = standing(user, now);

    if (purchase.kind === "subscription" && s === "paid") {
      throw new ConvexError(
        user.term === "threeYear"
          ? "PLAN|covered|Your Founding plan already covers you."
          : "PLAN|has_plan|You already have a plan. Switch or cancel it from Manage billing.",
      );
    }
    if (purchase.kind === "founding") {
      if (s === "paid") throw new ConvexError("PLAN|has_plan|Founding 200 is for new customers. Cancel your current plan from Manage billing first.");
      const spots: { left: number } = await ctx.runQuery(internal.billing.foundingLeftInternal, {});
      if (spots.left <= 0) throw new ConvexError(`PLAN|founding_full|All ${FOUNDING.cap} Founding spots are taken.`);
    }
    if (purchase.kind === "topup" && s !== "paid") {
      throw new ConvexError(`PLAN|topup_needs_plan|Top-ups add ${TOPUP.videos} videos to a paid plan. Pick a plan first.`);
    }

    const prices = await stripeCall(env.STRIPE_SECRET_KEY, "GET", "/prices", { lookup_keys: [args.lookupKey], active: "true", limit: 1 });
    const price = prices.data?.[0];
    if (!price) throw new ConvexError("PLAN|unavailable|That plan isn't available right now.");

    const mode = purchase.kind === "subscription" ? "subscription" : "payment";
    const metadata = { userId: user._id, lookupKey: args.lookupKey };
    const session = await stripeCall(env.STRIPE_SECRET_KEY, "POST", "/checkout/sessions", {
      mode,
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: user._id,
      metadata,
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email || undefined, ...(mode === "payment" ? { customer_creation: "always" } : {}) }),
      ...(mode === "subscription" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
      success_url: `${APP_URL()}/settings?checkout=success#s-plan`,
      cancel_url: `${APP_URL()}/settings?checkout=cancel#s-plan`,
    });
    return { url: session.url };
  },
});

export const foundingLeftInternal = internalQuery({
  args: {},
  handler: async (ctx: QueryCtx) => ({ left: Math.max(0, FOUNDING.cap - (await foundingTaken(ctx))) }),
});

/** Stripe's hosted billing portal: card, invoices, switch plan, cancel at period end. */
export const openPortal = action({
  args: {},
  handler: async (ctx: ActionCtx): Promise<{ url: string }> => {
    const user = await requireUser(ctx);
    if (!user.stripeCustomerId) throw new ConvexError("PLAN|no_customer|Nothing to manage yet. Pick a plan first.");
    const configs = await stripeCall(env.STRIPE_SECRET_KEY, "GET", "/billing_portal/configurations", { active: "true", limit: 20 });
    const ours = (configs.data ?? []).find((c: any) => c.metadata?.app === "manfriday");
    const session = await stripeCall(env.STRIPE_SECRET_KEY, "POST", "/billing_portal/sessions", {
      customer: user.stripeCustomerId,
      return_url: `${APP_URL()}/settings#s-plan`,
      ...(ours ? { configuration: ours.id } : {}),
    });
    return { url: session.url };
  },
});

// ── pause ─────────────────────────────────────────────────────────────────

/** Pause a paid plan for 1–3 days: posting is held, and the days are added to the term
 *  (subscriptions: the next charge moves out by that many days; Founding: access end moves). */
export const pausePlan = action({
  args: { days: v.number() },
  handler: async (ctx: ActionCtx, args): Promise<null> => {
    const user = await requireUser(ctx);
    const days = Math.floor(args.days);
    if (days < 1 || days > POLICY.pauseMaxDays) throw new ConvexError(`PLAN|pause_days|Pause for 1 to ${POLICY.pauseMaxDays} days.`);
    const now = Date.now();
    if (standing(user, now) !== "paid") throw new ConvexError("PLAN|pause_needs_plan|Pausing is for paid plans.");
    if (user.pausedUntil && user.pausedUntil > now) throw new ConvexError("PLAN|already_paused|Your plan is already paused.");
    if (user.lastPauseStartedAt && now < user.lastPauseStartedAt + PAUSE_COOLDOWN_DAYS * DAY) {
      throw new ConvexError(`PLAN|pause_cooldown|You can pause once every ${PAUSE_COOLDOWN_DAYS} days.`);
    }
    if (user.term !== "threeYear" && user.stripeSubscriptionId) {
      const sub = await stripeCall(env.STRIPE_SECRET_KEY, "GET", `/subscriptions/${user.stripeSubscriptionId}`);
      const periodEnd: number = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
      const base = Math.max(periodEnd ?? 0, sub.trial_end ?? 0);
      // Moving the next charge out is how Stripe extends a paid term without refunds or credit.
      await stripeCall(env.STRIPE_SECRET_KEY, "POST", `/subscriptions/${user.stripeSubscriptionId}`, {
        trial_end: base + days * 86400,
        proration_behavior: "none",
      });
    }
    await ctx.runMutation(internal.billing.applyPause, { userId: user._id, days });
    return null;
  },
});

export const applyPause = internalMutation({
  args: { userId: v.id("users"), days: v.number() },
  handler: async (ctx: MutationCtx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user) return null;
    const now = Date.now();
    await ctx.db.patch("users", args.userId, {
      pausedUntil: now + args.days * DAY,
      lastPauseStartedAt: now,
      ...(user.term === "threeYear" && user.accessEndsAt ? { accessEndsAt: user.accessEndsAt + args.days * DAY } : {}),
    });
    return null;
  },
});

/** End a pause early. Held posts go out now; days already added to the term stay added. */
export const resumePlan = mutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const user = await ctx.db.get("users", userId);
    const now = Date.now();
    if (!user?.pausedUntil || user.pausedUntil <= now) return null;
    await ctx.db.patch("users", userId, { pausedUntil: now });
    await releaseHeld(ctx, userId, now);
    return null;
  },
});

async function releaseHeld(ctx: MutationCtx, userId: Id<"users">, at: number) {
  const posts = await ctx.db.query("posts").withIndex("by_userId", (q) => q.eq("userId", userId)).take(200);
  for (const post of posts) {
    const pubs = await ctx.db.query("publications").withIndex("by_postId", (q) => q.eq("postId", post._id)).take(5);
    for (const p of pubs) {
      if (p.status === "queued" && (p.lastError ?? "").startsWith("PAUSED_HELD")) {
        await ctx.db.patch("publications", p._id, { publishAt: at, lastError: undefined });
      }
    }
  }
}

/** Operator check: which Stripe account and mode the Convex key belongs to, and
 *  whether the catalog is visible from it. Returns no secrets. */
export const diagnoseStripe = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const key = env.STRIPE_SECRET_KEY ?? "";
    const out: Record<string, unknown> = {
      keyKind: key.startsWith("sk_test_") ? "secret test" : key.startsWith("sk_live_") ? "secret LIVE" : key.startsWith("rk_") ? "restricted" : key ? "unrecognised" : "missing",
      webhookSecretSet: !!env.STRIPE_WEBHOOK_SECRET,
    };
    try {
      const acct = await stripeCall(key, "GET", "/account");
      out.account = acct.id;
      out.name = acct.settings?.dashboard?.display_name ?? acct.business_profile?.name ?? null;
    } catch (err) {
      out.accountError = err instanceof Error ? err.message : String(err);
    }
    try {
      const prices = await stripeCall(key, "GET", "/prices", { lookup_keys: ["solo_monthly"], limit: 1 });
      out.soloMonthlyFound = (prices.data ?? []).length > 0;
      const products = await stripeCall(key, "GET", "/products", { limit: 100 });
      out.products = (products.data ?? []).map((p: any) => `${p.active ? "active" : "archived"}: ${p.name}`);
    } catch (err) {
      out.catalogError = err instanceof Error ? err.message : String(err);
    }
    return out;
  },
});

/** Account deletion: stop billing immediately, no proration refund, no invoice. */
export const cancelSubscriptionNow = internalAction({
  args: { subscriptionId: v.string() },
  handler: async (_ctx: ActionCtx, args): Promise<null> => {
    try {
      await stripeCall(env.STRIPE_SECRET_KEY, "DELETE", `/subscriptions/${args.subscriptionId}`);
    } catch (err) {
      // Already canceled is fine; anything else is logged for a manual follow-up.
      console.error("cancel on delete failed", args.subscriptionId, err instanceof Error ? err.message : String(err));
    }
    return null;
  },
});

// ── webhook appliers (called only from convex/http.ts after signature check) ──

async function alreadyApplied(ctx: MutationCtx, eventId: string, type: string): Promise<boolean> {
  const seen = await ctx.db.query("stripeEvents").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).unique();
  if (seen) return true;
  await ctx.db.insert("stripeEvents", { eventId, type });
  return false;
}

async function findUser(ctx: MutationCtx, userId: string | undefined, customerId: string | undefined): Promise<Doc<"users"> | null> {
  if (userId) {
    const id = ctx.db.normalizeId("users", userId);
    const byId = id ? await ctx.db.get("users", id) : null;
    if (byId) return byId;
  }
  if (customerId) {
    return await ctx.db.query("users").withIndex("by_stripeCustomerId", (q) => q.eq("stripeCustomerId", customerId)).first();
  }
  return null;
}

export const recordIgnored = internalMutation({
  args: { eventId: v.string(), type: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    await alreadyApplied(ctx, args.eventId, args.type);
    return null;
  },
});

export const applyOneTimePurchase = internalMutation({
  args: {
    eventId: v.string(),
    userId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    lookupKey: v.string(),
    paidAt: v.number(),
  },
  handler: async (ctx: MutationCtx, args) => {
    if (await alreadyApplied(ctx, args.eventId, "checkout.session.completed")) return null;
    const user = await findUser(ctx, args.userId, args.customerId);
    const purchase = parseLookupKey(args.lookupKey);
    if (!user || !purchase) return null;
    const customer = args.customerId ? { stripeCustomerId: args.customerId } : {};

    if (purchase.kind === "topup") {
      await ctx.db.patch("users", user._id, { topupVideos: (user.topupVideos ?? 0) + TOPUP.videos, ...customer });
      return null;
    }
    if (purchase.kind === "founding") {
      // Paid is paid: if two buyers race for the last spot, both are honoured.
      const number = user.foundingNumber ?? (await foundingTaken(ctx)) + 1;
      await ctx.db.patch("users", user._id, {
        plan: "active",
        tier: purchase.tier,
        term: "threeYear",
        foundingNumber: number,
        accessEndsAt: addMonths(args.paidAt, 36),
        periodAnchorAt: args.paidAt,
        periodStartsAt: args.paidAt,
        videosUsedThisPeriod: 0,
        cancelAt: undefined,
        paymentFailedAt: undefined,
        ...customer,
      });
    }
    return null;
  },
});

export const applySubscription = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    userId: v.optional(v.string()),
    customerId: v.string(),
    subscriptionId: v.string(),
    status: v.string(),
    lookupKey: v.optional(v.string()),
    cancelAt: v.optional(v.number()), // ms
  },
  handler: async (ctx: MutationCtx, args) => {
    if (await alreadyApplied(ctx, args.eventId, args.type)) return null;
    const user = await findUser(ctx, args.userId, args.customerId);
    if (!user) return null;
    const now = Date.now();
    const ended = args.type === "customer.subscription.deleted" || ["canceled", "unpaid", "incomplete_expired"].includes(args.status);

    if (ended) {
      if (user.stripeSubscriptionId && user.stripeSubscriptionId !== args.subscriptionId) return null; // an old subscription
      const founding = user.term === "threeYear" && (user.accessEndsAt ?? 0) > now;
      await ctx.db.patch("users", user._id, {
        stripeSubscriptionId: undefined,
        cancelAt: undefined,
        paymentFailedAt: undefined,
        ...(founding ? {} : { plan: "canceled" as const }),
      });
      return null;
    }
    if (!["active", "trialing", "past_due"].includes(args.status)) return null; // incomplete: wait for payment
    const purchase = parseLookupKey(args.lookupKey);
    if (!purchase || purchase.kind !== "subscription") return null;

    const continuing = user.plan === "active" && user.stripeSubscriptionId === args.subscriptionId;
    await ctx.db.patch("users", user._id, {
      plan: "active",
      tier: purchase.tier,
      term: purchase.term,
      stripeCustomerId: args.customerId,
      stripeSubscriptionId: args.subscriptionId,
      cancelAt: args.cancelAt,
      paymentFailedAt: args.status === "past_due" ? (user.paymentFailedAt ?? now) : undefined,
      // A new plan starts a fresh month; a switch (Solo → Studio) keeps this month's count.
      ...(continuing ? {} : { periodAnchorAt: now, periodStartsAt: now, videosUsedThisPeriod: 0 }),
    });
    return null;
  },
});

export const applyInvoice = internalMutation({
  args: { eventId: v.string(), type: v.string(), customerId: v.string(), paid: v.boolean() },
  handler: async (ctx: MutationCtx, args) => {
    if (await alreadyApplied(ctx, args.eventId, args.type)) return null;
    const user = await findUser(ctx, undefined, args.customerId);
    if (!user) return null;
    await ctx.db.patch("users", user._id, { paymentFailedAt: args.paid ? undefined : (user.paymentFailedAt ?? Date.now()) });
    return null;
  },
});
