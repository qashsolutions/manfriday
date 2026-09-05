export const SITE = {
  name: "Man Friday",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://manfriday.app",
  tagline: "You build. Friday posts.",
  description:
    "Paste your product's URL and Friday studies what's trending in your niche, drafts the videos, and posts them to TikTok and YouTube Shorts — every day. You approve with a swipe.",
} as const;

/** D4 v3 (5 Sep 2026): 7-day trial, no card on day one, card required on day 2. */
export const TRIAL = {
  days: 7,
  cardByDay: 2,
  pauseMaxDays: 3,
  inactivityLogoutMinutes: 60,
} as const;

/** D5 v3 (5 Sep 2026): two tiers × four terms. Prices in USD. */
export type Tier = {
  id: "solo" | "studio";
  name: string;
  monthly: number;
  quarterly: number;
  annual: number;
  threeYear: number; // Founding 100 only — pay today, no cancellation
  saves: number; // content saves (right-swipes rendered) per month
  credits: number; // AI studio credits per month
  workspaces: number;
  highlight: boolean;
};

export const TIERS: readonly Tier[] = [
  {
    id: "solo",
    name: "Solo",
    monthly: 20,
    quarterly: 50,
    annual: 150,
    threeYear: 100,
    saves: 20,
    credits: 300,
    workspaces: 2,
    highlight: false,
  },
  {
    id: "studio",
    name: "Studio",
    monthly: 40,
    quarterly: 100,
    annual: 250,
    threeYear: 200,
    saves: 100,
    credits: 600,
    workspaces: 2,
    highlight: true,
  },
] as const;

/** The 3-year deal is scoped to the first N customers, pay-today, non-cancellable. */
export const FOUNDING = { cap: 100, label: "Founding 100" } as const;

export const SHARED_FEATURES = [
  "Slideshows, faceless videos + 20 AI avatars",
  "Direct publish to TikTok + YouTube Shorts",
  "Trend library curated for your niche",
  "Any content language — all 14 below",
  "Analytics + “more like this”",
] as const;

/** D6 v2 (5 Sep 2026): launch content languages. */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "id", name: "Indonesian" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "gu", name: "Gujarati" },
  { code: "pa", name: "Punjabi" },
  { code: "or", name: "Odia" },
] as const;
