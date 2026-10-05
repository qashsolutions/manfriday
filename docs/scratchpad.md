# Working scratchpad

Updated as we go. The plan lives in `docs/plan_oct04.md`; this is the running log:
what is being worked on, what was decided, what is open.

## Now

- Phase 0 closing out: icons shipped; TikTok resubmission and Resend key are with the user.
- Next build: Phase 1, beta invites (Clerk invitations), then product email.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 4 Oct | Browsing the trend library is free; turning one into a video costs a video | Looking costs us nothing and is the best reason to sign up; making already has a price |
| 4 Oct | No account farms, bought/"warmed" accounts, or bot engagement, ever | Violates platform rules; we hold YouTube API approval under attestation and a TikTok review is open |
| 4 Oct | Build and marketing run in parallel from 5 Oct, not sequentially | The product is a marketing tool; everything we ship can be demonstrated on ourselves and on prospects the same week |
| 4 Oct | Acquisition motion = teardowns, not DMs: the user pings 3–5 people per language, we return a hand-written channel read plus videos in their language | Personal, legal, and it doubles as user research and content |
| 4 Oct | Pilot runs on the Clerk **development** instance for 1–2 weeks; testers are told their account is temporary | Free and immediate; if it works we move to production and remap accounts by email |
| 4 Oct | Beta testers get **25** videos, not 3 | Enough to use the product properly for two weeks while still reaching the at-zero screen |
| 4 Oct | Phase 1 cannot start until the Clerk instance question is settled | Dev instances brand emails as development, use shared OAuth credentials, cap at 100 users, and do not transfer users — tester data would be lost at launch |
| 4 Oct | Creator pilots start at $100/video with creators under 5,000 followers, sourced by our own outlier search | Nano rates are $20–$100 on TikTok; niche fit beats follower count; we own the better sourcing tool |
| 4 Oct | Scale comes from languages × platforms × genuine accounts, plus paid creators | What the data on breakout posts actually shows working |
| 4 Oct | Screen-recording b-roll ranks above the discovery features | 14 of 16 breakout posts show a face next to moving software; we can produce neither |
| 4 Oct | Pricing unchanged at $20/$40 | We already undercut the category; creator payouts come from the Founding 200 offer instead |
| 16 Sep | Every feature must answer "what does the user get" | Standing product rule |

## Weekly scorecard

| Week ending | Posts | Views | Clicks to site | Signups | Activated | Kept ≥1 | Published ≥1 | Feedback | Failures |
|---|---|---|---|---|---|---|---|---|---|
| 10 Oct | — | — | — | — | — | — | — | — | — |

## Open questions

- Who approves raising a winning creator from $100 to $200–$300?

- Creator pilot budget confirmed at $1,000 (10 × $100). Open: who signs off on raising winners to $200–$300?
- Which market after English: Brazil, Indonesia or Spanish Latin America?

## How this file is kept up to date

An `eod-checkpoint` agent (`.claude/agents/eod-checkpoint.md`) runs at the end of
each weekday. It checks what shipped, whether the site, worker, tests and
compliance are healthy, and which plan items genuinely moved, then appends a
dated entry below and updates the status markers in `docs/plan_oct04.md`. It
never marks an item done on code alone — the acceptance test decides.

Run it any time with: `/agents` → eod-checkpoint, or ask for "an EOD checkpoint".

## Running notes

- 4 Oct: product email built and verified live (welcome, previews ready, post live/draft, render failed, Monday digest). Unsubscribe is one click, no sign-in, token in the footer. 71 Convex tests.

- 4 Oct: manfriday.app verified in Resend; alerts now send from alerts@manfriday.app and were delivered. Inbound mail untouched (Hostinger MX intact). Email to testers is unblocked. Free plan: 100/day, 3,000/month.

- 4 Oct: alert email verified live through Resend (test sender → operator inbox). manfriday.app shows **Failed** in Resend's Domains — DNS records need adding before any email can reach a tester.

- 4 Oct: invite-only turned on in Clerk (Development). Worker polling backed off from ~2.6M to ~260K Convex calls a month — the free plan allows 1M, so the old rate would have billed or throttled during the pilot.

- 4 Oct: repo had been overwritten by an unrelated project; Man Friday restored and the Vercel connection re-made.
- 4 Oct: vidIQ credits 68, refresh to 150 on 8 Oct. Phase 4 study needs ~100.
- 4 Oct: verified live — pipeline, worker, publishing, stats cron, billing, compliance, 63 + 18 tests green.
