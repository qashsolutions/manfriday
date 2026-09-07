export const SITE = {
  name: "Man Friday",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://manfriday.app",
  tagline: "You build. Friday posts.",
  description:
    "Paste your product's URL and Friday studies what's trending in your niche, drafts the videos, and posts them to TikTok and YouTube Shorts — every day. You approve with a swipe.",
} as const;

/** D4 v4 (6 Sep 2026): Free tier replaces the timed trial — card only at checkout. */
export const POLICY = {
  pauseMaxDays: 3,
  inactivityLogoutMinutes: 60,
} as const;

/** Free plan: try Friday with no card. One-time allowance, not monthly. */
export const FREE = {
  name: "Free",
  videosTotal: 3, // slideshow/hook formats; avatar renders are paid
  workspaces: 1,
} as const;

/** D5 v5 (6 Sep 2026): the visible unit is VIDEOS per month (avatar sub-cap).
 *  Credits remain internal metering only — never user-facing. */
export type Tier = {
  id: "solo" | "studio";
  name: string;
  monthly: number;
  quarterly: number;
  annual: number;
  threeYear: number; // Founding 200 only — pay today, no cancellation
  videos: number; // rendered videos per month, any format mix
  avatarVideos: number; // of which may be avatar renders
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
    threeYear: 200,
    videos: 20,
    avatarVideos: 5,
    workspaces: 2,
    highlight: false,
  },
  {
    id: "studio",
    name: "Studio",
    monthly: 40,
    quarterly: 100,
    annual: 250,
    threeYear: 300,
    videos: 100,
    avatarVideos: 15,
    workspaces: 2,
    highlight: true,
  },
] as const;

export const TOPUP = { videos: 10, avatarVideos: 3, price: 5 } as const;

/** The 3-year deal is scoped to the first N customers, pay-today, non-cancellable. */
export const FOUNDING = { cap: 200, label: "Founding 200" } as const;

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
