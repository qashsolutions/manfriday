import { ConvexError } from "convex/values";
/** The video allowance — the one number a user pays for (D5 v6: videos per month).
 *
 *  Free: FREE.videosTotal videos, once. Paid: the tier's videos every month,
 *  resetting on the day the plan started, no rollover; bought top-up videos are
 *  used after the monthly allowance and keep while the plan is active. A video
 *  is charged when it is requested (a keep, or an "also in" variant) and given
 *  back if its render fails for good.
 *
 *  Pure functions first (tested directly), then the two database helpers.
 */
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { FREE, TIERS } from "../lib/site";

export type BilledFrom = "free" | "plan" | "topup" | "unlimited";

/** Shown as "remaining" for unlimited accounts (JSON has no Infinity). */
export const UNLIMITED_REMAINING = 9999;

type UserBilling = Pick<
  Doc<"users">,
  "plan" | "tier" | "term" | "videosUsedThisPeriod" | "periodAnchorAt" | "periodStartsAt" | "topupVideos" | "accessEndsAt" | "pausedUntil" | "superUser"
>;

/** Same wall-clock moment `n` months after `anchor`, clamped to the month's last day. */
export function addMonths(anchor: number, n: number): number {
  const d = new Date(anchor);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

/** The allowance month containing `now`, counted from the plan's anchor day. */
export function currentPeriod(anchor: number, now: number): { start: number; end: number } {
  const a = new Date(anchor);
  const b = new Date(now);
  let n = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (n < 0) n = 0;
  while (n > 0 && addMonths(anchor, n) > now) n--;
  while (addMonths(anchor, n + 1) <= now) n++;
  return { start: addMonths(anchor, n), end: addMonths(anchor, n + 1) };
}

export type Standing = "free" | "paid" | "lapsed";

export function standing(u: UserBilling, now: number): Standing {
  if (u.plan === "free") return "free";
  if (u.plan === "active" || u.plan === "paused") {
    if (u.term === "threeYear") return u.accessEndsAt !== undefined && now < u.accessEndsAt ? "paid" : "lapsed";
    return "paid";
  }
  return "lapsed";
}

export type Meter = {
  standing: Standing; // from the real plan, so checkout rules still apply to a super user
  unlimited: boolean;
  limit: number; // videos in this allowance (Free: lifetime; paid: this month)
  used: number;
  topup: number; // bought videos left (paid plans only)
  remaining: number; // what the next keep can draw on, top-ups included
  resetsAt: number | null; // paid plans: when the monthly allowance refills
  periodStart: number | null;
};

export function meter(u: UserBilling, now: number): Meter {
  const m = plainMeter(u, now);
  return u.superUser ? { ...m, unlimited: true, remaining: UNLIMITED_REMAINING } : m;
}

function plainMeter(u: UserBilling, now: number): Meter {
  const s = standing(u, now);
  if (s === "free") {
    const used = u.videosUsedThisPeriod;
    return { standing: s, unlimited: false, limit: FREE.videosTotal, used, topup: 0, remaining: Math.max(0, FREE.videosTotal - used), resetsAt: null, periodStart: null };
  }
  if (s === "lapsed") {
    return { standing: s, unlimited: false, limit: 0, used: 0, topup: u.topupVideos ?? 0, remaining: 0, resetsAt: null, periodStart: null };
  }
  const tier = TIERS.find((t) => t.id === u.tier) ?? TIERS[0];
  const period = currentPeriod(u.periodAnchorAt ?? now, now);
  // A new month started since the counter was last touched: nothing used yet.
  const used = u.periodStartsAt === period.start ? u.videosUsedThisPeriod : 0;
  const topup = u.topupVideos ?? 0;
  return {
    standing: s,
    unlimited: false,
    limit: tier.videos,
    used,
    topup,
    remaining: Math.max(0, tier.videos - used) + topup,
    resetsAt: period.end,
    periodStart: period.start,
  };
}

/** What charging one video changes, or why it can't. */
export function planCharge(u: UserBilling, now: number):
  | { ok: true; from: BilledFrom; patch: Partial<Doc<"users">>; periodStart: number | null }
  | { ok: false; reason: "free_used" | "month_used" | "no_plan" } {
  // Team test account: never charged, never refused, never counted.
  if (u.superUser) return { ok: true, from: "unlimited", patch: {}, periodStart: null };
  const m = meter(u, now);
  if (m.standing === "lapsed") return { ok: false, reason: "no_plan" };
  if (m.standing === "free") {
    if (m.remaining <= 0) return { ok: false, reason: "free_used" };
    return { ok: true, from: "free", patch: { videosUsedThisPeriod: m.used + 1 }, periodStart: null };
  }
  if (m.used < m.limit) {
    return { ok: true, from: "plan", patch: { videosUsedThisPeriod: m.used + 1, periodStartsAt: m.periodStart! }, periodStart: m.periodStart };
  }
  if (m.topup > 0) {
    return { ok: true, from: "topup", patch: { topupVideos: m.topup - 1, videosUsedThisPeriod: m.used, periodStartsAt: m.periodStart! }, periodStart: m.periodStart };
  }
  return { ok: false, reason: "month_used" };
}

/** Undo a charge. A plan video from a month that has since reset is not given back. */
export function planRefund(u: UserBilling, from: BilledFrom, billedPeriodStart: number | null, now: number): Partial<Doc<"users">> | null {
  if (from === "unlimited") return null;
  if (from === "topup") return { topupVideos: (u.topupVideos ?? 0) + 1 };
  if (from === "free") return { videosUsedThisPeriod: Math.max(0, u.videosUsedThisPeriod - 1) };
  const m = meter(u, now);
  if (m.periodStart === null || m.periodStart !== billedPeriodStart) return null;
  return { videosUsedThisPeriod: Math.max(0, m.used - 1), periodStartsAt: m.periodStart };
}

export const EXHAUSTED_MESSAGE: Record<"free_used" | "month_used" | "no_plan", string> = {
  free_used: `ALLOWANCE|free_used|You've used your ${FREE.videosTotal} free videos.`,
  month_used: "ALLOWANCE|month_used|You've used this month's videos.",
  no_plan: "ALLOWANCE|no_plan|Your plan has ended.",
};

/** Charge one video to the user, or throw the ALLOWANCE message the app turns into a choice. */
export async function chargeVideo(ctx: MutationCtx, userId: Id<"users">): Promise<{ from: BilledFrom; periodStart: number | null }> {
  const user = await ctx.db.get("users", userId);
  if (!user) throw new Error("not signed in");
  const charge = planCharge(user, Date.now());
  if (!charge.ok) throw new ConvexError(EXHAUSTED_MESSAGE[charge.reason]);
  if (Object.keys(charge.patch).length > 0) await ctx.db.patch("users", userId, charge.patch);
  return { from: charge.from, periodStart: charge.periodStart };
}

export async function refundVideo(ctx: MutationCtx, userId: Id<"users">, from: BilledFrom | undefined, periodStart: number | undefined) {
  if (!from) return;
  const user = await ctx.db.get("users", userId);
  if (!user) return;
  const patch = planRefund(user, from, periodStart ?? null, Date.now());
  if (patch) await ctx.db.patch("users", userId, patch);
}
