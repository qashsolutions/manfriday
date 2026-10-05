import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Friday Internals · contract 1 (+ learning-loop tables from contract 4),
// updated for D4v4/D5v5: Free tier (no timed trial; card only at checkout),
// two tiers × four terms, videos/month as the visible unit, Founding 200, pause. Key choices: publications are normalized away
// from posts (one post → N platform publications); the render queue lives in
// the DB (Python worker long-polls renderJobs); credits are an append-only
// ledger with users.credits as cache; YouTube's daily quota gets its own
// transactional counter table.

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    foundingNumber: v.optional(v.number()), // 1–200, null after the cap
    tier: v.optional(v.union(v.literal("solo"), v.literal("studio"))),
    term: v.optional(
      v.union(
        v.literal("monthly"),
        v.literal("quarterly"),
        v.literal("annual"),
        v.literal("threeYear"),
      ),
    ),
    plan: v.union(
      v.literal("free"),
      v.literal("trial"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("canceled"),
      v.literal("none"),
    ),
    trialEndsAt: v.optional(v.number()),
    cardAddedAt: v.optional(v.number()), // D4v4: card appears only at paid checkout
    pausedUntil: v.optional(v.number()), // pause ≤3 days; days added to term
    stripeCustomerId: v.optional(v.string()),
    // ── billing (M4, 16 Sep 2026) — written only by convex/billing.ts ──
    stripeSubscriptionId: v.optional(v.string()),
    accessEndsAt: v.optional(v.number()), // Founding 200: purchase + 3 years (+ paused days)
    cancelAt: v.optional(v.number()), // subscription set to end at period end
    paymentFailedAt: v.optional(v.number()), // last invoice failed; cleared when one is paid
    periodAnchorAt: v.optional(v.number()), // monthly allowance resets on this day of the month
    periodStartsAt: v.optional(v.number()), // start of the allowance month videosUsedThisPeriod counts
    topupVideos: v.optional(v.number()), // bought top-up videos left; used after the monthly allowance
    lastPauseStartedAt: v.optional(v.number()),
    // Team test account: unlimited videos, no allowance charge. Billing flows still
    // work so checkout can be tested. Set only via internal admin:setSuperUser.
    superUser: v.optional(v.boolean()),
    // Beta testers: replaces the 3 free videos with a larger one-time allowance.
    // Set only via internal admin:setVideoGrant.
    videoGrant: v.optional(v.number()),
    // "Keep it and it's on your calendar" — on unless the user turns it off.
    autoSchedule: v.optional(v.boolean()),
    // Product email: one welcome per account, an unsubscribe token, and the opt-out.
    welcomeEmailedAt: v.optional(v.number()),
    emailToken: v.optional(v.string()),
    emailOptOut: v.optional(v.boolean()),
    credits: v.number(), // cached sum of creditLedger (internal metering)
    videosUsedThisPeriod: v.number(), // rendered videos this period (the visible unit); lifetime on Free
    avatarVideosUsedThisPeriod: v.optional(v.number()), // deprecated 15 Sep 2026 (sub-caps dropped); unused
    timezone: v.string(), // IANA; publish slots resolve here
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"])
    .index("by_foundingNumber", ["foundingNumber"]),

  brands: defineTable({
    // the brand brief (Claude call site 1 output; user edits it)
    userId: v.id("users"),
    url: v.string(),
    name: v.string(),
    oneLiner: v.string(),
    audience: v.array(v.string()),
    tone: v.array(v.string()),
    niche: v.string(),
    language: v.string(), // D6: per-brand content language (en, es, pt-BR, id, hi, …)
    // D6 v3 (docs/language-ux.md): how Indic languages sound, and the
    // brand's other markets for the "also in" sheet (inferred, user-editable).
    languageStyle: v.optional(v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"))),
    markets: v.optional(v.array(v.string())),
    screenshotIds: v.array(v.id("_storage")), // scraped product shots for slides
    // D2 (amended 14 Sep 2026): the presenter is the user's own uploaded photo —
    // animated for the hook of avatar videos. Consent timestamp = the user
    // attested it is them (or someone who gave written permission).
    presenterImageId: v.optional(v.id("_storage")),
    presenterConsentAt: v.optional(v.number()),
    // Presenter voice for every format (TTS): explicit user choice, never inferred.
    voice: v.optional(v.union(v.literal("female"), v.literal("male"))),
    status: v.union(v.literal("analyzing"), v.literal("ready")),
    briefVersion: v.number(), // bumped on user edit; concepts pin it
  }).index("by_userId", ["userId"]),

  trendTemplates: defineTable({
    // the curated library
    slug: v.string(),
    format: v.union(
      v.literal("slideshow"),
      v.literal("hook_video"),
      v.literal("avatar"),
    ),
    niches: v.array(v.string()),
    hookPattern: v.string(), // "confession-turn", "pov", "listicle", …
    refUrl: v.string(), // link only — reference video is NEVER rehosted
    refStats: v.object({
      platform: v.string(),
      views: v.number(),
      capturedAt: v.number(),
    }),
    structure: v.any(), // templateSpec v1.1 JSON — see contract 2
    specVersion: v.number(),
    engagementScore: v.number(), // curation-time score, drives matching
    active: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_format", ["format"])
    .index("by_active_and_engagementScore", ["active", "engagementScore"]),

  concepts: defineTable({
    // one generated candidate
    userId: v.id("users"),
    brandId: v.id("brands"),
    templateId: v.id("trendTemplates"),
    briefVersion: v.number(),
    specVersion: v.number(),
    language: v.string(), // pinned at generation time (brand language then)
    languageStyle: v.optional(v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"))),
    variantOf: v.optional(v.id("concepts")), // "also in" variant of a kept concept
    status: v.union(
      v.literal("draft"),
      v.literal("preview_ready"),
      v.literal("kept"),
      v.literal("skipped"),
      v.literal("render_queued"),
      v.literal("rendered"),
      v.literal("failed"),
    ),
    slots: v.any(), // call site 2 output, schema-validated at generation
    previewThumbId: v.optional(v.id("_storage")),
    videoId: v.optional(v.id("_storage")),
    batchId: v.string(), // groups one generation batch
    costCents: v.number(), // running media+LLM cost, for telemetry
    // Which allowance paid for this video, so a failed render can give it back.
    billedFrom: v.optional(v.union(v.literal("free"), v.literal("plan"), v.literal("topup"), v.literal("unlimited"))),
    billedPeriodStartsAt: v.optional(v.number()),
    swipedAt: v.optional(v.number()),
  }).index("by_userId_and_status", ["userId", "status"]),

  pipelineRequests: defineTable({
    // "Friday's first day": user submits a URL; the Python worker runs
    // scrape -> brief -> match -> slot-fill -> concepts (reusing M1 code).
    userId: v.id("users"),
    url: v.string(),
    // kind "variant": re-slot-fill one kept concept in another language
    // (docs/language-ux.md §2); url is the brand url for logging only.
    kind: v.optional(v.union(v.literal("generate"), v.literal("variant"))),
    conceptId: v.optional(v.id("concepts")),
    language: v.optional(v.string()),
    languageStyle: v.optional(v.union(v.literal("code-mixed"), v.literal("native"), v.literal("roman"))),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("analyzing"),
      v.literal("drafting"),
      v.literal("done"),
      v.literal("failed"),
    ),
    brandId: v.optional(v.id("brands")),
    batchId: v.optional(v.string()),
    error: v.optional(v.string()),
    claimedBy: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    // "also in" variants are charged when requested; refunded if the request fails.
    billedFrom: v.optional(v.union(v.literal("free"), v.literal("plan"), v.literal("topup"), v.literal("unlimited"))),
    billedPeriodStartsAt: v.optional(v.number()),
    previewsEmailedAt: v.optional(v.number()), // "your first videos are ready", sent once per batch
  })
    .index("by_status", ["status"])
    .index("by_userId", ["userId"]),

  renderJobs: defineTable({
    // the Python worker's queue
    conceptId: v.id("concepts"),
    kind: v.union(v.literal("preview"), v.literal("final")),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    priority: v.number(), // final > preview; paid > trial
    claimedBy: v.optional(v.string()), // worker instance id
    claimedAt: v.optional(v.number()), // stale-claim reaper uses this
    attempts: v.number(),
    error: v.optional(v.string()),
  }).index("by_status_and_priority", ["status", "priority"]),

  oauthStates: defineTable({
    // CSRF state for platform OAuth; minted per attempt, single-use, short-lived
    userId: v.id("users"),
    provider: v.union(v.literal("tiktok"), v.literal("youtube"), v.literal("google")),
    state: v.string(),
    used: v.boolean(),
  }).index("by_state", ["state"]),

  socialAccounts: defineTable({
    userId: v.id("users"),
    platform: v.union(v.literal("tiktok"), v.literal("youtube")),
    handle: v.string(),
    platformUserId: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessToken: v.string(), // encrypted; touched only in actions
    refreshToken: v.string(),
    expiresAt: v.number(),
    status: v.union(
      v.literal("connected"),
      v.literal("expired"),
      v.literal("revoked"),
    ),
  })
    .index("by_userId", ["userId"])
    .index("by_platform_and_status", ["platform", "status"]),

  posts: defineTable({
    // one scheduling decision
    userId: v.id("users"),
    conceptId: v.id("concepts"),
    publishAt: v.number(),
    captionByPlatform: v.any(),
    liveEmailedAt: v.optional(v.number()), // "your post went out", sent once per post
    // NOTHING publishes without this. Set when the user confirms the post —
    // immediately when they press Schedule themselves, or by tapping Approve on
    // a video Friday scheduled for them. (YouTube attestation: every upload is
    // user-initiated.)
    approvedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  publications: defineTable({
    // one post × one platform (contract 3)
    postId: v.id("posts"),
    accountId: v.id("socialAccounts"),
    platform: v.union(v.literal("tiktok"), v.literal("youtube")),
    status: v.union(
      v.literal("queued"),
      v.literal("publishing"),
      v.literal("live"),
      v.literal("draft_fallback"),
      v.literal("failed"),
    ),
    platformPostId: v.optional(v.string()),
    publishAt: v.number(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    idempotencyKey: v.string(), // = publication _id; adapters retry safely
  })
    .index("by_status_and_publishAt", ["status", "publishAt"]) // scheduler scan
    .index("by_postId", ["postId"])
    .index("by_accountId", ["accountId"]), // stats refresh + purge on disconnect

  metrics: defineTable({
    // time-series snapshots per publication
    publicationId: v.id("publications"),
    capturedAt: v.number(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
  }).index("by_publicationId_and_capturedAt", ["publicationId", "capturedAt"]),

  creditLedger: defineTable({
    // append-only; users.credits is a cache
    userId: v.id("users"),
    delta: v.number(), // negative on spend
    reason: v.string(), // "final_render" | "avatar_render" | "monthly_grant" | "call_bonus" | "topup" | …
    refId: v.optional(v.string()),
  }).index("by_userId", ["userId"]),

  feedback: defineTable({
    // "Tell us what broke" from inside the app. Never auto-deleted; read by admin:listFeedback.
    userId: v.optional(v.id("users")),
    email: v.string(),
    page: v.string(),
    message: v.string(),
    handled: v.optional(v.boolean()),
  }).index("by_handled", ["handled"]),

  pendingGrants: defineTable({
    // A tester's allowance set BEFORE they sign up. admin:setVideoGrant writes
    // one of these when no users row exists yet; users:ensureCurrent consumes it
    // on the first sign-in, so the invite → sign-up → 25 videos path needs no
    // hand-timed command. Consumed rows are deleted.
    email: v.string(), // lower-cased
    videos: v.number(),
  }).index("by_email", ["email"]),

  alerts: defineTable({
    // Something failed that a human should see: a render, a post, a brief.
    kind: v.string(), // "render_failed" | "publish_failed" | "brief_failed" | "feedback"
    message: v.string(),
    userEmail: v.optional(v.string()),
    refId: v.optional(v.string()),
    notifiedAt: v.optional(v.number()), // set once the email is away
  }).index("by_notifiedAt", ["notifiedAt"]),

  stripeEvents: defineTable({
    // Webhook idempotency: an event is applied and recorded in the same mutation.
    eventId: v.string(),
    type: v.string(),
  }).index("by_eventId", ["eventId"]),

  quotaCounters: defineTable({
    // e.g. YouTube uploads/day, global
    key: v.string(), // "youtube:2026-09-06"
    used: v.number(),
    limit: v.number(),
  }).index("by_key", ["key"]),

  // ── learning loop (contract 4) ──────────────────────────────────────────

  voiceEdits: defineTable({
    // Friday's draft → the user's rewrite; last N ride into call site 2 as few-shots
    userId: v.id("users"),
    brandId: v.id("brands"),
    slotType: v.string(), // "hook" | "slide" | "caption"
    draft: v.string(),
    rewrite: v.string(),
  }).index("by_brandId", ["brandId"]),

  trackedLinks: defineTable({
    // one short link per post, UTM-tagged: manfriday.app/l/<slug>
    postId: v.id("posts"),
    slug: v.string(),
    targetUrl: v.string(),
  })
    .index("by_slug", ["slug"])
    .index("by_postId", ["postId"]),

  linkClicks: defineTable({
    // the money signal, one row per click
    linkId: v.id("trackedLinks"),
    clickedAt: v.number(),
    referrerPlatform: v.optional(v.string()),
  }).index("by_linkId_and_clickedAt", ["linkId", "clickedAt"]),
});
