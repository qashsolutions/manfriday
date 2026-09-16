import { describe, expect, test } from "vitest";
import { CATALOG } from "../../lib/billing-catalog";
import { TIERS, TOPUP } from "../../lib/site";

describe("Stripe catalog mirrors the public pricing", () => {
  test("every tier has monthly, quarterly, annual and a one-time Founding price at the site's amounts", () => {
    for (const t of TIERS) {
      const p = CATALOG.find((c) => c.key === t.id)!;
      const by = Object.fromEntries(p.prices.map((x) => [x.term, x]));
      expect(by.monthly.amountCents).toBe(t.monthly * 100);
      expect(by.monthly.recurring).toEqual({ interval: "month", intervalCount: 1 });
      expect(by.quarterly.amountCents).toBe(t.quarterly * 100);
      expect(by.quarterly.recurring).toEqual({ interval: "month", intervalCount: 3 });
      expect(by.annual.amountCents).toBe(t.annual * 100);
      expect(by.annual.recurring).toEqual({ interval: "year", intervalCount: 1 });
      expect(by.three_year.amountCents).toBe(t.threeYear * 100);
      expect(by.three_year.recurring).toBeUndefined();
      expect(p.metadata.videos_per_month).toBe(String(t.videos));
    }
  });

  test("the top-up is a one-time price at the site's amount", () => {
    const topup = CATALOG.find((c) => c.key === "topup")!;
    expect(topup.prices).toHaveLength(1);
    expect(topup.prices[0].amountCents).toBe(TOPUP.price * 100);
    expect(topup.prices[0].recurring).toBeUndefined();
  });

  test("lookup keys are unique and names never mention a platform", () => {
    const keys = CATALOG.flatMap((c) => c.prices.map((p) => p.lookupKey));
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CATALOG) expect(c.name).not.toMatch(/youtube|tiktok/i);
  });
});
