# Man Friday — scope status (living tracker, updated 14 Sep 2026, evening)

Legend: ✅ done · 🟡 partial · ⬜ not started · 🔒 waiting on a third party

## M0 — marketing site + blog
| Item | Status | Notes |
|---|---|---|
| Landing v2, pricing, signup shell | ✅ | live at manfriday.app |
| Blog (MDX, sitemap, RSS, robots) | 🟡 | plumbing done; only 2 posts — daily-postable cadence not started |
| Legal pages | 🟡 | privacy/terms live and Google-approved; counsel review before beta |
| Search Console / Bing | 🟡 | Google verified + sitemap; Bing not done |

## M1 — headless pipeline (URL → brief → 10 concepts, 3 formats)
| Item | Status | Notes |
|---|---|---|
| Scrape → brand brief (Claude call site 1) | ✅ | |
| Trend matching + slot-fill (call site 2) | ✅ | 141 templates seeded; discovery to 300–500 open |
| Slideshow + hook-video render | ✅ | Pillow + ffmpeg, Latin + all 10 Indic scripts |
| **AI avatar format** | 🟡 | 14 Sep: user-photo presenter (upload + consent in Settings), hook-only talking head via FAL Kling v2, product b-roll tail, AI-generated flag on YouTube. Built and unit-tested; **first real render pending a presenter photo** |
| 14-language pipeline (FAL + Sarvam) | ✅ | Roman-script style untested |
| Worker deploy | ✅ | Railway, 14 Sep; trial plan → Hobby upgrade pending |

## M2 — Picks UI
| Item | Status | Notes |
|---|---|---|
| Swipe feed, keep → final render, "also in" variants | ✅ | |
| Language chip + how-it-sounds | ✅ | |
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
| Stripe billing (Free → paid, Founding 200 counter, pause, top-ups) | ⬜ | Settings shows M4 placeholders; no Stripe code |
| Beta invites | ⬜ | |
| Calculator pages (SEO) | ⬜ | |
| Resend / PostHog / Axiom | ⬜ | named in privacy policy as processors; not integrated, no keys |
| Analytics by language | ⬜ | |

## Launch checklist (from CLAUDE.md)
Clerk production instance + Pro plan (passkeys/MFA) + deletion switch · counsel review · Bing · Railway Hobby · TikTok prod creds + Direct Post after audit · YouTube quota audit result · trend library to 300–500 (niches to confirm) · Mum-Test calls · delete the two private test Shorts.

## Compliance guard
`npm run compliance` runs on every push and weekly (validation/compliance). CLAUDE.md "YouTube API compliance — non-negotiables" governs any scope/consent-screen change.
