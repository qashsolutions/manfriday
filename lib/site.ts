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
  videosTotal: 3, // any format
} as const;

/** Guest accounts for friends testing the product (21 Nov 2026): invite-only,
 *  at most `cap` at a time, deleted — data and sign-in — `days` after first
 *  sign-in. The invite link itself lapses after `inviteDays`. */
export const GUEST = {
  cap: 10,
  days: 21,
  videos: 25,
  inviteDays: 7,
} as const;

/** D5 v6 (15 Sep 2026): the visible unit is VIDEOS per month, any format — no sub-caps.
 *  Credits remain internal metering only — never user-facing. */
export type Tier = {
  id: "solo" | "studio";
  name: string;
  monthly: number;
  quarterly: number;
  annual: number;
  threeYear: number; // Founding 200 only — pay today, no cancellation
  videos: number; // rendered videos per month, any format mix
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
    highlight: true,
  },
] as const;

export const TOPUP = { videos: 10, price: 5 } as const;

/** The 3-year deal is scoped to the first N customers, pay-today, non-cancellable. */
export const FOUNDING = { cap: 200, label: "Founding 200" } as const;

/** Every line here must describe something that works today (21 Nov 2026 audit:
 *  "2 workspaces", "hands-free", "direct publish to TikTok" and "more like this"
 *  were advertised but never built, and confused testers). */
export const SHARED_FEATURES = [
  "Slideshows, faceless videos, and presenter videos that open on your photo",
  "YouTube Shorts: Friday posts at the time you approve",
  "TikTok: Friday sends the video to your TikTok inbox — you tap post",
  "Tracked links — see which post sent people to you",
  "Trend library curated for your niche",
  "Any content language — all 14, Hinglish included",
  "Link clicks for every post, plus YouTube view counts",
] as const;

/** What uses up a video, and what doesn't. Mirrors convex/allowance.ts + convex/feed.ts. */
export const VIDEO_RULES = {
  picksPerBatch: 10, // worker/pipeline/generate.py default count
  counts: [
    "Swiping right on a pick: Friday renders it in full quality",
    "Each extra language of a kept video (“also in”)",
  ],
  free: [
    "Previews, browsing and skipping",
    "Posting one video to both TikTok and YouTube Shorts — it counts once",
    "A render that fails — the video is given back automatically",
  ],
  note: "Deleting a video you kept doesn't give it back — skip in Picks instead.",
} as const;

/** D6 v2 (5 Sep 2026): launch content languages. */
export const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "pt-BR", name: "Portuguese (Brazil)", native: "Português" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ" },
] as const;
