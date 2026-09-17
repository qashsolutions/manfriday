import { describe, expect, test } from "vitest";
import { atZero, meterChip, parseBillingError, type BillingView } from "../../lib/billing-copy";

const base: BillingView = {
  standing: "paid", unlimited: false, limit: 20, used: 0, topup: 0, remaining: 20, resetsAt: Date.UTC(2026, 9, 3), tier: "solo", term: "monthly",
  foundingNumber: null, accessEndsAt: null, cancelAt: null, paymentFailed: false, pausedUntil: null, canPause: true, pauseAvailableAt: null, canManage: true,
};

describe("billing copy", () => {
  test("reads the structured error from a Convex client failure, and ignores anything else", () => {
    expect(parseBillingError({ data: "ALLOWANCE|free_used|You've used your 3 free videos." })).toEqual({ kind: "ALLOWANCE", reason: "free_used", message: "You've used your 3 free videos." });
    expect(parseBillingError(new Error("[CONVEX M(feed:swipe)] Uncaught ConvexError: PLAN|has_plan|You already have a plan.\n    at handler"))?.reason).toBe("has_plan");
    expect(parseBillingError(new Error("network down"))).toBeNull();
  });

  test("a team account reads UNLIMITED", () => {
    expect(meterChip({ ...base, unlimited: true, standing: "free", remaining: 9999 }).text).toBe("UNLIMITED");
  });

  test("the meter says free, low and out plainly", () => {
    expect(meterChip({ ...base, standing: "free", limit: 3, remaining: 2 }).text).toBe("2 OF 3 FREE");
    expect(meterChip({ ...base, remaining: 2 }).tone).toBe("low");
    expect(meterChip({ ...base, remaining: 0 }).tone).toBe("out");
    expect(meterChip({ ...base, remaining: 12, topup: 4 }).title).toMatch(/Includes 4 top-up/);
    expect(meterChip({ ...base, paymentFailed: true }).text).toBe("PAYMENT FAILED");
    expect(meterChip({ ...base, standing: "lapsed", remaining: 0 }).text).toBe("PLAN ENDED");
  });

  test("at zero on Free, the sheet offers the two plans and says previews stay free", () => {
    const s = atZero("free_used", { ...base, standing: "free" });
    expect(s.title).toMatch(/3 free videos/);
    expect(s.body).toMatch(/Previews stay free/);
    expect(s.actions.map((a) => ("lookupKey" in a ? a.lookupKey : "portal"))).toEqual(["solo_monthly", "studio_monthly"]);
  });

  test("at zero on Solo, the sheet leads with a top-up, offers Studio, and names the refill day", () => {
    const s = atZero("month_used", { ...base, remaining: 0, used: 20 });
    expect(s.title).toBe("You've used this month's 20 videos.");
    expect(s.body).toMatch(/refill on/);
    expect(s.actions[0]).toMatchObject({ lookupKey: "topup_10", primary: true });
    expect(s.actions[1]).toMatchObject({ portal: true });
  });

  test("Studio and Founding users at zero aren't offered a switch", () => {
    expect(atZero("month_used", { ...base, tier: "studio", limit: 100 }).actions).toHaveLength(1);
    expect(atZero("month_used", { ...base, term: "threeYear" }).actions).toHaveLength(1);
  });
});
