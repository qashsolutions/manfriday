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
- **D2 Formats:** slideshows, faceless hook videos, AI avatars (~20 curated stock characters; no build-your-own until v2). Avatar lipsync renders lazily on right-swipe only. Users pick a default character — the brand's recurring presenter; persona consistency is a named v1 feature ("your brand gets a face"), added 4 Sep from the competitor teardown.
- **D3 Target user:** solo app/SaaS builders (the category's proven wedge).
- **D4 Monetization (v4, 6 Sep):** private beta → paid at launch. **Free tier replaces the timed trial** (Claude-style): no card, browse the full Picks feed, 3 videos one-time (no avatar), 1 workspace; card appears only at paid checkout. **Pause plan** (paid only): up to 3 days; paused days are added to the term. **Auth spec (v2, locked 7 Sep):** Clerk with passkeys + Google + GitHub (enabled 8 Sep) + any email — lineup FINAL for beta; social platforms are NEVER identity providers (TikTok/IG connect as publishing accounts only — platform bans must not lock users out). Account creation is step 1 (free, no card). **MFA policy: optional at signup; HARD GATE at the M3 connect step — passkey OR 2FA required before any social account can be connected** (posting tokens are the crown jewels; passkey alone satisfies the gate — no TOTP-on-top theater). **Auto-logout after 60 min inactivity**, self-serve **delete data**. "Log in" and "Start free" are two entry points into ONE Clerk flow. Provider lineup locks before beta users arrive (late additions create duplicate-account headaches).
- **D5 Pricing (v5, 6 Sep — the visible unit is VIDEOS/MONTH; credits are internal metering only):** **Solo $20/mo = 20 videos** (≤5 avatar) · **Studio $40/mo = 100 videos** (≤15 avatar); 2 workspaces each; Studio highlighted. **Top-up +10 videos (≤3 avatar) = $5.** Avatar caps are the whole margin question (see docs/unit-economics.md); provisional until M1 costCents telemetry, finalize before launch. Competitor check 6 Sep: we undercut every rung ($20 vs $29, $40 vs $49) and give multi-language on ALL plans (they gate it at $149). Quarterly $50/$100 · Annual $150/$250 · **3 years $200/$300 — "Founding 200" only: first 200 customers, pay today, no cancellation** (amended 5 Sep from 100/200@first-100 for margin headroom) (deliberate traction/cash hook; treated as CAC — monthly allowances cap the COGS exposure; visible spots counter). Any language on every plan. Credit top-up packs are the upsell; COGS target < ~30% via allowances.
- **D6 Languages (v2, 5 Sep):** per-brand content language through the whole pipeline (brief → slot-fill → captions → hashtags → TTS). **Launch set (14): en, es, pt-BR, id + Sarvam's Indic set (hi, bn, ta, te, mr, kn, ml, gu, pa, or)**. Indonesian only for "bahasa" (no Malay in v1). TTS behind `TTSAdapter` (hard req: word timestamps); FAL multilingual at launch, Sarvam for Indic, ElevenLabs later as premium voice. UI chrome stays English in v1.
- **Growth hooks (locked 4 Sep):** (1) **Blog** at manfriday.app/blog — MDX, daily-postable, full SEO plumbing (sitemap, RSS, OG images, structured data); ships before M1 with the marketing site. (2) The **Founding 200 3-yr offer** above ($200/$300), framed as pay-today scarcity with a visible spots counter.
- **Web app only** — responsive, PWA-grade; Picks screen mobile-first. No native apps in v1. (The market leader is also web-only as of Sep 2026 — no app-store presence; parity confirmed.)

## Stack (locked — founder-proven)

Next.js on Vercel · **Convex** (DB, live queries, scheduler, job queue) · Clerk (auth incl. MFA) ·
**Python + ffmpeg render worker on Railway** (long-polls Convex `renderJobs`) · FAL (media gen/TTS/lipsync) ·
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
- M4 (wk 8–9): metrics ingestion, "more like this", Stripe billing (Free tier → paid checkout; card only at subscribe) + Founding-200 counter + pause/top-ups, beta invites, book-a-call button, free calculator pages on manfriday.app (engagement-rate + creator-earnings; static, deterministic, zero COGS — SEO doors into the trial, from the competitor teardown).

## Launch checklist (accumulating)

- [ ] Clerk production instance: custom OAuth credentials required for Google AND GitHub (dev uses Clerk shared creds; ~5 min per provider) + production pk/sk into Vercel + **Clerk Pro plan (~$25/mo) — passkeys and MFA/TOTP are Pro features** (free on dev instance; the connect-step MFA gate depends on them)
- [ ] Final Terms/Privacy counsel review (drafts live)
- [ ] Google Search Console + Bing Webmaster: verify domain, submit sitemap

## Pre-build checklist (the design gate)

- [x] git init + first commit of docs (remote: github.com/qashsolutions/manfriday, branch main)
- [x] TikTok developer app created + Content Posting API audit application **submitted 10 Sep 2026** (in review; video.upload only — Direct Post/video.publish deferred to a later revision; demo + recipe in docs/tiktok-app-config.md). Until approval, publishing = sandbox draft-to-inbox.
- [ ] Google Cloud project + YouTube Data API enabled + quota-increase application submitted
- [x] Template spec validated by hand-producing 3 real posts with it (validation/template-spec/ — PASS, spec bumped to v1.1, see FINDINGS.md)
- [ ] Trend library curation started (300–500 hand-tagged templates, 3–5 niches — longest lead-time item)
- [ ] Accounts provisioned: Convex, Clerk, Railway, FAL, Anthropic API, Resend, Axiom, PostHog, Stripe
- [ ] ~15 Mum-Test discovery calls with target users
- [ ] User sign-off on screens + prototype

## Operating principle (from the category leader's founder playbook)

Customer calls are a standing work stream, not a phase: book-a-call button ships day one
(+7 trial days per call), ~20 calls/week target, Mum-Test questions, silent usability tests.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
