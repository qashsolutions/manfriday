import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    // Self-minted; authenticates the Railway/local render worker's calls.
    WORKER_TOKEN: v.optional(v.string()),
    // Claude call sites 1 + 2 (brand brief, slot-fill) run in Convex actions.
    ANTHROPIC_API_KEY: v.optional(v.string()),
    // M3 publishing (contract 3 adapters run as Convex actions)
    TIKTOK_CLIENT_KEY: v.optional(v.string()),
    TIKTOK_CLIENT_SECRET: v.optional(v.string()),
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    // YouTube Data API units/day granted to the project (10,000 until the quota
    // audit clears). Raise it in the Convex dashboard when Google raises ours —
    // compliance rule 7: never work around the limit, schedule around it.
    YOUTUBE_DAILY_QUOTA: v.optional(v.string()),
  },
});

export default app;
