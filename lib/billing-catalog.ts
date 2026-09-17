/** The Stripe catalog, derived from the public pricing constants (lib/site.ts)
 *  so the site, checkout and Stripe can never disagree.
 *
 *  Every price has a stable lookup key; app code asks Stripe for prices by
 *  lookup key, never by price ID, so the same code works in test and live mode.
 */
import { TIERS, TOPUP, FOUNDING } from "./site";

export type CatalogPrice = {
  lookupKey: string;
  amountCents: number;
  /** Absent = one-time. */
  recurring?: { interval: "month" | "year"; intervalCount: number };
  term: "monthly" | "quarterly" | "annual" | "three_year" | "topup";
};

/** Stripe Tax code: Software as a service, business use. Man Friday is bought by
 *  founders for their product's marketing, so business use is the honest class.
 *  (Old products on this account carried a childcare code — never copy it.) */
export const TAX_CODE = "txcd_10103001";

export type CatalogProduct = {
  key: string; // metadata.mf_key — how the sync script finds the product again
  taxCode: string;
  name: string;
  description: string;
  metadata: Record<string, string>;
  prices: CatalogPrice[];
};

const cents = (usd: number) => Math.round(usd * 100);

export const CATALOG: CatalogProduct[] = [
  ...TIERS.map((t) => ({
    key: t.id,
    taxCode: TAX_CODE,
    name: `Man Friday ${t.name}`,
    description: `${t.videos} videos a month, any format. ${t.workspaces} workspaces. Every language.`,
    metadata: { app: "manfriday", mf_key: t.id, videos_per_month: String(t.videos), workspaces: String(t.workspaces) },
    prices: [
      { lookupKey: `${t.id}_monthly`, amountCents: cents(t.monthly), recurring: { interval: "month" as const, intervalCount: 1 }, term: "monthly" as const },
      { lookupKey: `${t.id}_quarterly`, amountCents: cents(t.quarterly), recurring: { interval: "month" as const, intervalCount: 3 }, term: "quarterly" as const },
      { lookupKey: `${t.id}_annual`, amountCents: cents(t.annual), recurring: { interval: "year" as const, intervalCount: 1 }, term: "annual" as const },
      // Founding 200: pay today for three years, no cancellation — a one-time price.
      { lookupKey: `${t.id}_founding_3y`, amountCents: cents(t.threeYear), term: "three_year" as const },
    ],
  })),
  {
    key: "topup",
    taxCode: TAX_CODE,
    name: `Man Friday Top-up: ${TOPUP.videos} videos`,
    description: `${TOPUP.videos} more videos this month, any format. Paid plans only.`,
    metadata: { app: "manfriday", mf_key: "topup", videos: String(TOPUP.videos) },
    prices: [{ lookupKey: `topup_${TOPUP.videos}`, amountCents: cents(TOPUP.price), term: "topup" }],
  },
];

export const FOUNDING_CAP = FOUNDING.cap;
