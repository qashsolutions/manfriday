import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    // Self-minted; authenticates the Railway/local render worker's calls.
    WORKER_TOKEN: v.optional(v.string()),
    // Claude call sites 1 + 2 (brand brief, slot-fill) run in Convex actions.
    ANTHROPIC_API_KEY: v.optional(v.string()),
  },
});

export default app;
