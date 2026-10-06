import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    // Self-minted; authenticates the Railway/local render worker's calls.
    WORKER_TOKEN: v.optional(v.string()),
    // Claude call sites 1 + 2 (brand brief, slot-fill) run in the PYTHON WORKER
    // on Railway, not here — see worker/pipeline/brief.py and slots.py. Nothing
    // in convex/ calls Anthropic, so this key is unused by the deployment and
    // can be removed from its environment.
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
    // M4 billing. Test-mode keys until launch; set in the Convex dashboard, never in code.
    STRIPE_SECRET_KEY: v.optional(v.string()),
    STRIPE_WEBHOOK_SECRET: v.optional(v.string()),
    // Where Checkout and the portal send people back to (default https://manfriday.app).
    APP_URL: v.optional(v.string()),
    // Alerting + product email (Resend). Alerts are recorded even without this.
    RESEND_API_KEY: v.optional(v.string()),
    ALERT_EMAIL: v.optional(v.string()),
    ALERT_FROM: v.optional(v.string()),
    EMAIL_FROM: v.optional(v.string()), // product email sender; defaults to Friday <friday@manfriday.app>
  },
});

export default app;
