export const SITE = {
  name: "Man Friday",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://manfriday.app",
  tagline: "You build. Friday posts.",
  description:
    "Paste your product's URL and Friday studies what's trending in your niche, drafts the videos, and posts them to TikTok and YouTube Shorts — every day. You approve with a swipe.",
} as const;

/** D5 (amended 4 Sep 2026): one plan, four terms. USD. */
export const PRICING = {
  monthly: 20,
  quarterly: 50,
  annual: 150,
  threeYear: 200,
  threeYearList: 450, // 3 × annual — what the founding offer is discounted from
  foundingCap: 1000,
  trialDays: 30,
} as const;

export const PLAN_FEATURES = [
  "Slideshows, faceless videos + 20 AI avatars",
  "Direct publish to TikTok + YouTube Shorts",
  "Trend library curated for your niche",
  "Content in English, Spanish, Portuguese or Indonesian",
  "Analytics + “more like this”",
] as const;
