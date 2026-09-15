# Man Friday (codename: Project Viral)

Short-form video content engine for solo builders, modeled on the category leader's proven playbook.
**Product name: Man Friday** · domain **manfriday.app** (owned; Vercel wiring deferred).
"Project Viral" is the internal codename only — never user-facing.

## Working process (mandated)

**Plan → Design → Build, with hard gates.** Build starts only after the design gate clears.
Current status (4 Sep 2026, late): **BUILD STARTED** on user's go — order: marketing site + blog first (SEO lead time), then M1 → M2 → M3, language support built in from the schema up. Artboard pricing copy (Founding 500 / $34/mo) predates the 4 Sep pricing amendment below — code is source of truth; refresh artboards opportunistically.

Source files live in-repo: `docs/project-viral-plan.html` (plan), `docs/friday-internals.html` (technical design), `design/*.dc.html` + `design/canvas.json` (the 9 design-canvas artboards; edit these and re-publish to the screens artifact via the design skill — never hand-edit the published artifact). Published versions:
- Plan: https://claude.ai/code/artifact/57f0657b-a3b7-4da5-9c4f-e4c581c7afc9
- Screens + clickable prototype (9 artboards): https://claude.ai/code/artifact/33ebe2e0-967f-4fd9-90f3-d43999c3f99e
- Friday Internals (schema, template spec, publish contract, learning loop): https://claude.ai/code/artifact/762120f5-0dbb-4ac7-96a1-9a59999431d7

## Locked decisions — do not relitigate

- **D1 Platforms:** TikTok + YouTube Shorts in v1. Instagram = fast follow. Slideshows are TikTok-only; hook/avatar videos cross-post to Shorts.
- **D2 Formats (amended 14 Sep 2026):** slideshows, faceless hook videos, AI avatars. **The presenter is the user's own uploaded photo** (Settings › Your presenter, with a consent attestation) — no stock characters (user decision 14 Sep; talking-head cost of $0.056–0.14/s made full-length stock avatars break the D5 caps). **Hook-only animation:** the photo speaks the first ≤8 s (`AVATAR_HOOK_SECONDS`) via FAL Kling AI Avatar v2 standard (~45¢), then the video cuts to product screenshots + captions with the voice continuing. Preview = free still frame; the talking clip renders only on right-swipe. No presenter → no avatar concepts are planned (match.py). Every avatar publish sets the platform's AI-generated flag (YouTube `containsSyntheticMedia`; TikTok `is_aigc` once Direct Post lands). "Your brand gets a face" stays a v1 feature; full-length presenter and build-your-own characters are v2.
- **D3 Target user:** solo app/SaaS builders (the category's proven wedge).
- **D4 Monetization (v4, 6 Sep):** private beta → paid at launch. **Free tier replaces the timed trial** (Claude-style): no card, browse the full Picks feed, 3 videos one-time (no avatar), 1 workspace; card appears only at paid checkout. **Pause plan** (paid only): up to 3 days; paused days are added to the term. **Auth spec (v2, locked 7 Sep):** Clerk with passkeys + Google + GitHub (enabled 8 Sep) + any email — lineup FINAL for beta; social platforms are NEVER identity providers (TikTok/IG connect as publishing accounts only — platform bans must not lock users out). Account creation is step 1 (free, no card). **MFA policy: optional at signup; HARD GATE at the M3 connect step — passkey OR 2FA required before any social account can be connected** (posting tokens are the crown jewels; passkey alone satisfies the gate — no TOTP-on-top theater). **Auto-logout after 60 min inactivity**, self-serve **delete data**. "Log in" and "Start free" are two entry points into ONE Clerk flow. Provider lineup locks before beta users arrive (late additions create duplicate-account headaches).
- **D5 Pricing (v5, 6 Sep — the visible unit is VIDEOS/MONTH; credits are internal metering only):** **Solo $20/mo = 20 videos** (≤5 avatar) · **Studio $40/mo = 100 videos** (≤15 avatar); 2 workspaces each; Studio highlighted. **Top-up +10 videos (≤3 avatar) = $5.** Avatar caps are the whole margin question (see docs/unit-economics.md); provisional until M1 costCents telemetry, finalize before launch. Competitor check 6 Sep: we undercut every rung ($20 vs $29, $40 vs $49) and give multi-language on ALL plans (they gate it at $149). Quarterly $50/$100 · Annual $150/$250 · **3 years $200/$300 — "Founding 200" only: first 200 customers, pay today, no cancellation** (amended 5 Sep from 100/200@first-100 for margin headroom) (deliberate traction/cash hook; treated as CAC — monthly allowances cap the COGS exposure; visible spots counter). Any language on every plan. Credit top-up packs are the upsell; COGS target < ~30% via allowances.
- **D6 Languages (v2, 5 Sep):** per-brand content language through the whole pipeline (brief → slot-fill → captions → hashtags → TTS). **Launch set (14): en, es, pt-BR, id + Sarvam's Indic set (hi, bn, ta, te, mr, kn, ml, gu, pa, or)**. Indonesian only for "bahasa" (no Malay in v1). TTS behind `TTSAdapter` (hard req: word timestamps); FAL multilingual at launch, Sarvam for Indic, ElevenLabs later as premium voice. UI chrome stays English in v1. **v3 addendum (10 Sep, design-approved): language UX is detect-then-chip — Friday infers the language in the brief and shows a chip ("Friday's pick"); the chip is a command-menu combobox (type-ahead in any script, keyboard-first) — NEVER a `<select>`, dropdown, or modal grid anywhere in the product. A "how it sounds" control sits beside it for Indic languages: Hinglish (code-mixed) / शुद्ध हिन्दी (native) / Roman script — maps to Sarvam Mayura `mode=code-mixed` + output script. Language also lives on the CONCEPT: every pick carries its language; after a keep, an "also in" sheet offers the brand's other markets (suggested from the brief's audience) — one tap = one more video, counted against the allowance. Sarvam facts (verified 10 Sep): Bulbul v3 TTS covers the 10 Indic launch languages + en-IN, 30+ voices, code-mixed in one pass; Bulbul returns NO word timestamps, so the Indic path adds a forced-alignment step in the render worker (Saaras streaming timestamps or a local aligner) to satisfy the `TTSAdapter` word-timestamp contract. Spec: docs/language-ux.md. **Rendering Indic text (13 Sep):** the brand fonts are Latin-only, so `worker/render/assets.py` picks a Noto Sans face per Unicode block (`script_of`), and correct shaping (conjuncts, matra reordering) requires Pillow built against **libraqm** — on the iMac: `brew install libraqm freetype harfbuzz fribidi` then `pip install --no-binary pillow --force-reinstall pillow` in `worker/.venv`; on Railway the image must install libraqm before pip (check `PIL.features.check('raqm')` at worker start — it logs a warning if false). Never ship Indic previews rendered without raqm.**
- **Growth hooks (locked 4 Sep):** (1) **Blog** at manfriday.app/blog — MDX, daily-postable, full SEO plumbing (sitemap, RSS, OG images, structured data); ships before M1 with the marketing site. (2) The **Founding 200 3-yr offer** above ($200/$300), framed as pay-today scarcity with a visible spots counter.
- **Landing v2 (design approved 10 Sep; spec docs/landing-v2.md):** the URL input IS the hero call to action (free brief; account creation still step 1 per D4 — the URL is carried through signup); a live Picks demo (trend reference beside Friday's concept) replaces placeholder cards; click attribution gets its own section (the north-star differentiator); how-it-works tiles show the product; "One pick. Every market you sell to." demos language as a multiplier; the founding offer stands alone. No bracketed placeholders on the live site — until beta numbers exist, show product facts instead. Marketing pages stay static; signed-in users land in the app (Picks-as-home: day-one state, then "Friday's week" with clicks first, views last; the plan meter in the rail is the only plan-aware chrome).
- **Web app only** — responsive, PWA-grade; Picks screen mobile-first. No native apps in v1. (The market leader is also web-only as of Sep 2026 — no app-store presence; parity confirmed.)

## Stack (locked — founder-proven)

Next.js on Vercel · **Convex** (DB, live queries, scheduler, job queue) · Clerk (auth incl. MFA) ·
**Python + ffmpeg render worker on Railway** (long-polls Convex `renderJobs`; **live on Railway since 14 Sep 2026** — project man-friday, service manfriday, root `worker`, Dockerfile builder, watch path `/worker/**`, auto-deploys on push to main; runbook docs/railway-worker.md; the iMac worker is stopped — start it only for local debugging, and stop it again, or two workers compete) · FAL (media gen/TTS/lipsync) ·
Claude API · Stripe · Resend · Axiom (logs) · PostHog (product analytics).
Supabase/Firebase/raw AWS/GCP were considered and ruled out. Cloud Run revisit only if render concurrency outgrows Railway replicas post-beta.

## Determinism-first (hard principle)

Claude is confined to **exactly two call sites**:
1. **Brand brief synthesis** — Claude Opus 5, one call per URL, cached forever, user edits result.
2. **Creative slot-fill** (hooks, slide lines, captions) — **Claude Opus (user directive 6 Sep: at least Opus 4.8 — use `claude-opus-5`; never Haiku)**, one batched call per 10+ concepts, structured outputs, prompt caching, Batch API for overnight pre-generation. ~1-2¢/video; still <2% of price under determinism-first.

Everything else is deterministic code: scraping (trafilatura/OG/JSON-LD), trend matching (tag scoring, no embeddings), trend-reference ingestion (page-fetch baseline via worker/pipeline/curate.py — always free/works; vidIQ is an optional paid enrichment layer at launch, never a dependency; decided 7 Sep), video assembly (Pillow + ffmpeg; backgrounds = brand screenshots / gradients / stock only — **never generative images**), caption timing (TTS word timestamps), hashtags/best-time (lookup tables), analytics ("plain stats").
**UX guardrail:** determinism is a cost tactic, never a UX tactic — optimize only where the user can't feel it.

## North star

"Options so laser-focused the user swipes right, uploads, and makes more money."
Measured: **right-swipe rate** (≥30% by week 4) + **tracked clicks to the user's product per week** (trackedLinks/linkClicks, manfriday.app/l/<slug> edge redirect). Reward ladder: swipe < published < views < watch% < click.
Marketing copy leads with click attribution ("see which post sent people to your product"), never raw views — that's the differentiator vs view-count tools.

## Naming + voice conventions

- The swipe screen is **"Picks"** — never "Blitz" (a competitor's term; deliberately renamed).
- **No competitor names in any doc, artifact, or commit message** — refer to "the category leader" / "the market leader" generically (user directive, 4 Sep 2026).
- The product is personified as **"Friday"** in all user-facing copy ("You build. Friday posts.", "Hire Friday", "Friday suggests 17:30"). Use "Friday", never gendered pronouns. Functional/security copy (MFA, billing mechanics) stays straight.
- Visual identity: **"Broadcast"** — graphite #0C0B10, panels #14131A, accent #FF4D6D, live mint #45E0B0, queued amber #F5C044; Archivo (expanded) display, Instrument Sans body, Spline Sans Mono labels. One flagship theme + light/dark; no user-selectable themes.

## Build milestones (start only after design gate)

- M0 (now): marketing site + blog live on Vercel — landing, pricing (new terms), signup shell, MDX blog with SEO plumbing.
- M1 (wk 1–3): headless pipeline — URL in → brand brief → 10 rendered concepts (all 3 formats). **If M1 output is weak, stop and fix before any UI.**
- M2 (wk 4–5): Picks UI over the pipeline; lazy full-res render on right-swipe.
- M3 (wk 6–7): TikTok + YouTube OAuth, calendar, scheduled publish (TikTok draft-to-inbox fallback until audit clears).
- M4 (wk 8–9): metrics ingestion (**YouTube view/like/comment counts + Analytics page shipped early, 12 Sep 2026** — TikTok counts wait for its API review), "more like this", Stripe billing (Free tier → paid checkout; card only at subscribe) + Founding-200 counter + pause/top-ups, beta invites, free calculator pages on manfriday.app (engagement-rate + creator-earnings; static, deterministic, zero COGS — SEO doors into the trial, from the competitor teardown).

## Launch checklist (accumulating)

- [ ] Clerk production instance: **turn on "Allow users to delete their accounts"** (the Settings › Delete flow calls user.delete() after purging Convex; enabled on the dev instance 13 Sep) · custom OAuth credentials required for Google AND GitHub (dev uses Clerk shared creds; ~5 min per provider) + production pk/sk into Vercel + **Clerk Pro plan (~$25/mo) — passkeys and MFA/TOTP are Pro features** (free on dev instance; the connect-step MFA gate depends on them)
- [ ] Final Terms/Privacy counsel review (drafts live)
- [x] Google Search Console: verified 11 Sep (both accounts), sitemap submitted · [ ] Bing Webmaster

## Pre-build checklist (the design gate)

- [x] git init + first commit of docs (remote: github.com/qashsolutions/manfriday, branch main)
- [x] TikTok developer app created + Content Posting API audit application **submitted 10 Sep 2026** (in review; video.upload only — Direct Post/video.publish deferred to a later revision; demo + recipe in docs/tiktok-app-config.md). Until approval, publishing = sandbox draft-to-inbox.
- [x] Google Cloud project + YouTube Data API enabled; **OAuth verification APPROVED 14 Sep 2026 for youtube.readonly + youtube.upload** (submitted 11 Sep; round-2 response 13 Sep (Google asked for a fuller demo + three privacy-policy disclosures → new demo https://youtu.be/_aZEliCyCOE recorded on the production app, privacy policy rewritten with 'uses / shares / protects Google user data' sections + Limited Use statement; checklist and reply in docs/google-verification-round2.md). Consent screen is now verified: no 'unverified app' interstitial, no 100-user cap on these scopes.; **YouTube API quota/compliance audit submitted 12 Sep 2026** (company: Qash Solutions; use cases Video Uploading & Account Management + Tools for Creators + Analytics & Reporting; endpoints videos.insert / videos.list / channels.list; requested 300,000 units/day for videos.insert + 10,000 general; evidence + diagrams in docs/quota-screenshots and docs/diagrams) (scopes youtube.upload + youtube.readonly, sensitive not restricted → no CASA; app published to production; demo https://youtu.be/aRPVtmi-5EU unlisted; Google says first Trust & Safety email in 3–5 days, review up to 4–6 weeks; until approval the consent screen shows the unverified warning and the 100-user cap applies). Search Console verified, sitemap submitted. Default quota until the audit clears: 10,000 units/day ≈ 6 uploads/day.
- [x] Template spec validated by hand-producing 3 real posts with it (validation/template-spec/ — PASS, spec bumped to v1.1, see FINDINGS.md)
- [x] Trend library curation started (11 Sep: 141 templates seeded — 7 hand-made + 134 built from 252 vidIQ-sourced references hand-tagged in `worker/templates/curation/candidates.jsonl`; 6 niches: ai-tools, dev-tools, build-in-public, solo-saas, consumer-apps, productivity-tools. Tooling: `worker/pipeline/ingest_vidiq.py` → `build_templates.py` → `seed_library.py`. Target 300–500 still open — ~105 vidIQ credits left this month)
- [ ] Accounts provisioned: Convex, Clerk, Railway, FAL, Anthropic API, Resend, Axiom, PostHog, Stripe
- [ ] ~15 Mum-Test discovery calls with target users
- [ ] User sign-off on screens + prototype

## YouTube API compliance — non-negotiables (attested to Google 11–12 Sep 2026)

We signed the YouTube API Services Terms, Developer Policies, and a truthfulness attestation. Non-compliance = suspension of the API client, which kills publishing for every customer. These rules are enforced by `npm run compliance` (validation/compliance/youtube-compliance.mjs — runs in CI on every push, on PRs, and weekly against the live site) and must never be weakened to make a build pass.

1. **Declared use only.** Scopes: `youtube.upload` + `youtube.readonly`, nothing else. Endpoints: `videos.insert`, `videos.list` (our own published videos only), `channels.list` (mine=true, once at connect). **Never** `search.list`, comments, subscriptions, playlists, analytics, or any other channel's data. Adding a scope or endpoint = a change of use case: (1) write to YouTube describing the change, (2) wait for approval, (3) update the DECLARED block in the guard script in the same commit. No exceptions, no "temporary" calls.
2. **Every upload is user-initiated.** One explicit approval (keep) + one user-chosen schedule = one `videos.insert`. No bulk, no automated, no re-uploads without a fresh approval. The schedule mutation must keep its gate: own concept, status `rendered`.
3. **Tokens never leave the server.** No public query/mutation returns `accessToken`/`refreshToken`; no logging of tokens; the render worker never sees them. Tokens live only in Convex `socialAccounts`.
4. **Retention and deletion.** Disconnect and auth-expiry wipe both tokens and revoke at Google (`revokeAtProvider`). Delete account = `account.purgeMine` (revokes grants, deletes every user row and stored file) BEFORE the Clerk user is deleted. Stored YouTube data is limited to: tokens, channel ID + name, and per video WE published: video ID, title, publish time, view count. View counts: `convex/stats.ts` — daily cron 06:15 UTC, `videos.list part=statistics id=<our IDs>` ≤50/call, snapshots pruned after 30 days, purged on disconnect/expiry/deletion (shipped 12 Sep 2026). Never fetch stats on page load or more than once a day.
5. **Legal pages stay in sync.** /privacy must keep the YouTube section (YouTube API Services, Google Privacy Policy link, scopes, what we store, revocation incl. security.google.com permissions link); /terms must keep the YouTube Terms of Service clause. No bracketed placeholders on live pages. Any edit to these pages runs `npm run compliance` before push.
6. **Branding.** The product name never contains "YouTube"; YouTube is named only to describe the integration; no implied endorsement; use only official marks if a logo is ever added.
7. **Quota discipline.** Stay within granted quota (300k/day requested for videos.insert); request increases with usage data, never work around limits with extra projects or clients. One API client = one Google Cloud project (845649489196).
8. **Stay current.** Google emails about policy changes go to admin@manfriday.app; act on them, and re-submit the compliance form if the use case changes. The audit must be re-done if ownership, name, or scopes change. **Google's approval letter (14 Sep): any change to the OAuth consent screen configuration — app name, logo, authorised domains, homepage/privacy/terms URLs, scopes — requires a NEW verification request; verification is not inherited by new scopes. Keep Project Owner/Editor accounts current in the Cloud Console. Edit Branding/Data access only with a re-verification planned.**

## Operating principle (from the category leader's founder playbook)

Customer calls are a standing work stream, not a phase: ~20 calls/week target, Mum-Test questions,
silent usability tests. **No in-product "book a call / +7 days" offer** — user removed it 10 Sep 2026; calls are booked by outreach, not a site feature.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
