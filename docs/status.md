# Man Friday — scope status (living tracker, updated 14 Sep 2026, evening)

Legend: ✅ done · 🟡 partial · ⬜ not started · 🔒 waiting on a third party

## M0 — marketing site + blog
| Item | Status | Notes |
|---|---|---|
| Landing v2, pricing, signup shell | ✅ | live at manfriday.app |
| Blog (MDX, sitemap, RSS, robots) | 🟡 | 6 posts (4 illustrated flagship posts 16 Sep with theme-aware SVG figures, hero cards, per-post OG); cadence not yet regular |
| Legal pages | 🟡 | privacy/terms live and Google-approved; counsel review before beta |
| Search Console / Bing | 🟡 | Google verified + sitemap; Bing not done |

## M1 — headless pipeline (URL → brief → 10 concepts, 3 formats)
| Item | Status | Notes |
|---|---|---|
| Scrape → brand brief (Claude call site 1) | ✅ | |
| Trend matching + slot-fill (call site 2) | ✅ | 141 templates seeded; discovery to 300–500 open |
| Slideshow + hook-video render | ✅ | Pillow + ffmpeg, Latin + all 10 Indic scripts. Slideshows narrated since 15 Sep (per-slide voice timing); licensed music bed still ⬜ |
| **Presenter format** (was "AI avatar") | ✅ | 15 Sep: user photo as a still hook with push-in + voice-over, then product b-roll. Talking head / lip-sync built and REMOVED the same day after user testing (fluff, 40¢+/video). Cost now = hook video |
| 14-language pipeline (FAL + Sarvam) | ✅ | Roman-script style untested |
| Worker deploy | ✅ | Railway, 14 Sep; trial plan → Hobby upgrade pending |

## M2 — Picks UI
| Item | Status | Notes |
|---|---|---|
| Swipe feed, keep → final render, "also in" variants | ✅ | |
| Language chip + how-it-sounds | ✅ | Presenter voice (female/male) toggle added 15 Sep |
| Presenter photo (Settings) | ✅ | replaces the stock-character picker |

## M3 — publishing
| Item | Status | Notes |
|---|---|---|
| YouTube OAuth + Shorts upload | ✅ | OAuth verified 14 Sep; quota audit 🔒 pending (10k units/day until then) |
| TikTok OAuth + draft-to-inbox | ✅ | Content Posting audit 🔒 in review since 10 Sep; Direct Post after |
| Calendar + scheduled publish (cron) | ✅ | |
| MFA gate before connect, disconnect/revoke, delete account | ✅ | Clerk self-serve deletion on (dev instance) |
| User notices (expired access, failed post) | ✅ | |

## M4 — metrics, billing, growth
| Item | Status | Notes |
|---|---|---|
| YouTube view/like/comment counts + Analytics page | ✅ | daily, compliant |
| TikTok metrics | 🔒 | needs a scope not in the current TikTok audit |
| **Tracked links** (north-star metric) | ✅ | 14 Sep: slug per post at schedule time, appended to both captions (UTM-tagged target), `/l/<slug>` redirect logs clicks with platform from Referer, crawlers skipped; Analytics shows clicks per post |
| "Friday, more like this" | ⬜ | |
| Stripe billing (Free → paid, Founding 200 counter, pause, top-ups) | ⬜ | Settings shows M4 placeholders; no Stripe code. Pricing simplified 15 Sep: N videos/month, no avatar sub-caps |
| Beta invites | ⬜ | |
| Calculator pages (SEO) | ⬜ | |
| Resend / PostHog / Axiom | ⬜ | named in privacy policy as processors; not integrated, no keys |
| Analytics by language | ⬜ | |

## Launch checklist (from CLAUDE.md)
Clerk production instance + Pro plan (passkeys/MFA) + deletion switch · counsel review · Bing · Railway Hobby · TikTok prod creds + Direct Post after audit · YouTube quota audit result · trend library to 300–500 (niches to confirm) · Mum-Test calls · delete the two private test Shorts.

## Automated tests (16 Sep)
- **Worker** (`npm run test:worker`, CI on worker changes): 18 pytest checks with a fake voice — narration, resolution/fps, presenter hook→product cut, caption continuity, Indic shaping via libraqm, planner gating.
- **Convex** (`npm run test:convex`, CI on convex changes): 13 vitest/convex-test checks — schedule creates link + captions, D1 slideshow rule, discard rules, tokens never exposed, disconnect/expiry wipe + scheduled revoke, stats pruning/purge, delete-account cascade, click logging, presenter/voice.
- Not covered: browser flows through Clerk sign-in (deliberately skipped), publish adapters against real TikTok/YouTube (nightly live smoke ⬜).

## Compliance guard
`npm run compliance` runs on every push and weekly (validation/compliance). CLAUDE.md "YouTube API compliance — non-negotiables" governs any scope/consent-screen change.

## 16 Sep 2026 — first-session clarity (pre-Stripe)

Four things a new user hits in session one, each of which used to read as "broken":

1. **The wait after the URL.** Onboarding shows three stages with an ETA each, counts previews as they land, and says the work continues if you leave. Picks says "Friday is rendering your previews" instead of "the feed is empty" while drafts are queued.
2. **Where a post went.** Queue rows carry a plain line per platform. The TikTok inbox rule is stated once above the queue; the chip reads DRAFT IN TIKTOK, never "scheduled".
3. **Analytics cadence.** Empty state and the live header both say the first numbers arrive the next morning and refresh once a day.
4. **YouTube quota.** `convex/youtubeQuota.ts` + a capacity gate in `schedulePost`; the Calendar offers the next open day; a quota 403 defers to the next quota day. Limit in `YOUTUBE_DAILY_QUOTA` (default 10,000).

Also fixed: every app screen flashed a false empty state while Convex waited for the Clerk token (`AppAuthGate`); the Calendar claimed no accounts while they loaded; onboarding said "All 1 previews are ready".

Infrastructure: the Convex push had been failing since the test commit earlier that day (`import.meta` in the test harness) — tests moved to `tests/`. Nothing had deployed in between.

Next: Stripe billing (item 5 of the first-session list: the video meter and what happens at zero).
