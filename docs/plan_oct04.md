# Man Friday — build + marketing checklist (from 4 Oct 2026)

Working rules: one phase at a time, top to bottom. Every item has an acceptance
test, because "done" means a user can do the thing on manfriday.app, not that
code exists. Progress and decisions are tracked in `docs/scratchpad.md`.

Status key: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — unblock the current week

- [x] Site favicon + app icons, same artwork as the TikTok app icon (TikTok rejected the update over this)
- [ ] Resubmit the TikTok app with `design/manfriday-icon-1024.png` — **user action**
      *Accept: TikTok review shows "in review", not rejected.*
- [ ] Confirm Railway plan (worker renders today; billing not visible from here) — **user action**
- [x] Resend account + API key, with `ALERT_EMAIL` and `ALERT_FROM` set. Verified 4 Oct: alert delivered.
- [x] **manfriday.app verified in Resend** (4 Oct). DKIM TXT plus the two sending CNAMEs added at Hostinger; MX left alone, so admin@manfriday.app still receives. `ALERT_FROM` removed — alerts now send from alerts@manfriday.app and were delivered. We can email testers, not just ourselves.

## Phase 1 — before anyone else is invited

### 1a. Decide the auth instance FIRST (added 4 Oct — this was missed)

Inviting outsiders is not a pure code task. We are still on a Clerk
**development** instance, and that carries consequences for real testers:

- Clerk's emails carry a "development" prefix, and sign-in pages sit on an
  `accounts.dev` domain — it looks untrustworthy to someone you just invited.
- Google and GitHub sign-in use Clerk's **shared** OAuth credentials in
  development, so the consent screen is not ours.
- Development instances are capped at 100 users and lower rate limits.
- **User data does not transfer between instances.** Everyone who signs up on
  development has to register again at launch, and their Clerk ID changes — which
  orphans their Convex rows (brand, concepts, posts, Stripe customer) unless we
  write an email-to-ID remap.
- Passkeys and MFA are paid features in production (~$25/mo). Our own rule (D4)
  requires a passkey or 2FA **before** any social account can be connected, so
  without the paid plan the connect step — and therefore publishing — is blocked.

Two honest options:

- [ ] **Option A — move to a Clerk production instance now.** Paid plan, our own
      Google and GitHub credentials, DNS records for the Clerk domain, new keys in
      Vercel, `CLERK_JWT_ISSUER_DOMAIN` updated in Convex, the `convex` JWT
      template recreated, and the self-serve deletion switch turned on again.
      *Cost: ~$25/mo and an hour or two, most of it DNS and dashboard work.*
- [x] **Option B — pilot on development, knowingly (chosen 4 Oct).** One or two
      weeks with friendly testers who are told their account is temporary. If it
      goes well we move to production (Option A) and build an email-to-ID remap
      so nothing they made is lost.

### 1b. Build

- [x] **Beta invites.** Operator screen at `/admin`: send an invite, see its status, revoke it. Clerk sends the email and owns the sign-up link; every call is gated on the team flag, so a normal account cannot invite anyone.
      *Accept: an invited address can sign up; an uninvited one cannot.*
- [x] **Invite-only sign-up turned on** (Clerk → Configure → Access mode, Development instance), 4 Oct.
      *Verified 4 Oct: invite-only mode and invitations are available on all Clerk plans; allowlist/blocklist is the paid one, which we do not need.*
- [x] **Tester allowance: 25 videos.** `admin:setVideoGrant` replaces the 3 free videos for a named account; the meter and the at-zero sheet both respect it. Set to 25 for the founder account on 4 Oct.
- [x] **In-app feedback.** A "Something wrong?" button on every app screen; the message is stored, tagged with the screen they were on, and raised as an alert.
- [x] **Failure alerting.** A failed render, a failed brief and a failed post each raise an alert, recorded in the database and visible at `/admin`. Emails go out through Resend as soon as `RESEND_API_KEY` is set; until then nothing is lost and `alerts:flush` sends the backlog.
      *Accepted 4 Oct: a live alert was delivered to the operator inbox through Resend; the failure wiring (render, brief, post → alert naming the user) is covered by tests.*
- [ ] **Say the limits in the invite itself:** TikTok posts arrive as drafts until TikTok approves the app, and all users share roughly 6 YouTube uploads a day until the quota audit clears.
- [x] **Product email.** Five messages, each sent once, each with a one-click unsubscribe in the footer:
      welcome (first sign-in), "your first videos are ready" (3+ previews of a batch), "your video is live / waiting in TikTok" (first platform to succeed), "one video didn't render" (permanent failure, says the allowance was given back), and a Monday digest of last week's clicks and views (skipped for anyone who posted nothing).
      *Accepted 4 Oct: welcome, render-failed and post-draft each delivered live to a real inbox from friday@manfriday.app; unsubscribe, once-only sending and digest-skipping covered by tests.*
- [ ] **Timed fresh-user walkthrough** — needs the user to sign in as a new account; everything else in Phase 1 is done. on an account without the team flag: paste URL → keep → schedule → posted.
      *Accept: written log of every step with timings and every moment of confusion.*
- [ ] Fix whatever that walkthrough exposes before sending a single invite.

## Phase 2 — the format gap the research exposed

A live scan of 16 breakout posts in the solo-builder niche (4 Oct): 14 of 16 show a
human face, and the dominant tech format is a face next to the software actually
moving. We can produce neither the face nor the moving software.

- [ ] **Screen-recording b-roll.** Drive a headless browser through the user's own product and capture the clicks as video; use it where we currently use a static screenshot. Deterministic, no model, no new legal exposure.
      *Accept: a hook video whose middle section is the user's product in motion.*
- [ ] **Music bed** for slideshows and hook videos, from a licensed library.
      *Accept: every format ships with audio under the voice; licence recorded in the repo.*
- [ ] **Comment-gated call to action** as a caption option ("comment X and I'll send it"), paired with the tracked link.
      *Accept: selectable per concept, and the wording lands in both platforms' captions.*

## Phase 3 — what the user gets to see (the discovery layer)

- [ ] **Your own winners loop.** Rank the user's posts by clicks, name the pattern they share, bias the next drafts toward it.
      *Accept: after 10+ posts, the app states which pattern earns the most clicks for that user, and drafts shift measurably.*
- [ ] **Two-door onboarding.** "Paste your product URL" or "Show me what's working in my niche".
      *Accept: a signed-out visitor can browse the library before giving a URL.*
- [ ] **Library browse, free.** 141 curated templates, filtered by niche, format and hook pattern, each with its reference post and real numbers. Browsing is free; turning one into a video draws on the allowance exactly like a keep.
- [ ] **Example niche** so a signed-out visitor sees real output without burning a render.
- [ ] **Brand kit.** Lift colours, fonts and logo from the user's site once; every video matches.

## Phase 4 — the "what doesn't work" study (needs credits)

Outlier search only returns winners, so it cannot answer this. The valid method is a
representative sample.

- [ ] Pick 20 indie-builder accounts across TikTok, Instagram and Shorts.
- [ ] Pull each one's full library; compute that creator's median.
- [ ] Study the bottom quartile: which formats, hooks and lengths underperform **for the same creator who also has hits**.
- [ ] Write the findings into the template library as negative rules (what Friday should stop drafting).
      *Budget: ~5 credits per account, so ~100 credits. 68 now, 150 on 8 Oct.*

## Phase 5 — the marketing engine ("UGC at scale", done so we keep our API access)

### What this is NOT

Never, on any account we own or operate for a customer: bought or "warmed"
accounts, bulk account creation, near-duplicate accounts reposting the same
video, engagement pods, bots, or any automation that runs accounts we do not
own. TikTok's rules permit multiple accounts but prohibit exactly these
behaviours, and we hold YouTube API approval under a signed attestation plus a
TikTok submission in review. Losing either stops publishing for every customer.

### What it is

- [ ] **Owned accounts, one per platform per market.** Distinct content per account, never the same video reposted across them.
      *Accept: TikTok, YouTube and (later) Instagram accounts for Man Friday, posting daily.*
- [ ] **Dogfood: Man Friday posts about Man Friday, daily, run by Man Friday.** Marketing, demo and a daily product test in one.
      *Accept: 30 consecutive days posted with no manual editing.*
- [ ] **Paid creator pilot — 10 creators × $100.** Sourced with our own outlier search filtered to under 5,000 followers in the solo-builder niche; each posts one honest video from their own account with the paid-partnership label, and we take the raw file plus Spark Ads rights. Full playbook, rates, screening, outreach template and payback maths: `docs/creator-pilots.md`.
      *Accept: 10 posted videos, each with its own tracked link, judged at 14 days on clicks → signups → paid.*
- [ ] **Spark Ads / whitelisting.** The creator grants a code; the ad runs from the creator's own account. Permission must be agreed before filming, and typically adds 20–50% to the rate.
      *Accept: one creator post running as a Spark Ad with tracked clicks.*
- [ ] **Affiliate or referral.** Pricing note: 30% of a $20 plan is $6, too thin to interest a creator. The Founding 200 offer at $200 up front is the payout worth building on.
- [ ] **Language markets first where the product already works:** Brazil, Indonesia, Spanish-speaking Latin America. India waits for Instagram, because TikTok is banned there.
- [ ] **Blog + calculator pages** continue as the compounding channel.

## Service limits under a 5-tester pilot (checked 4 Oct)

| Service | What the pilot costs | Headroom |
|---|---|---|
| Convex | Worker polling was ~2.6M function calls/month against a **1M free allowance**; adaptive backoff cut it to ~260K. Video files count against 1 GB free storage — 5 testers × 25 videos is roughly half of it. | Fine now; watch file storage |
| FAL | ~2–6¢ a video. 125 videos ≈ $5–8 for the whole pilot. | Fine |
| Clerk | Development instance: 100-user cap, fine for 5. | Fine |
| Railway | One worker container renders sequentially; a render takes ~20–30 s, so ~100/hour. | Fine |
| YouTube | 6 uploads a day **shared by everyone** until the quota audit clears. | The binding limit — cap the pilot at 5–6 testers |

- [ ] Watch Convex file storage during the pilot; old preview files are the first thing to prune if it gets close.

## Phase 6 — launch gates

- [ ] Clerk production instance: Pro plan (passkeys + MFA), own Google and GitHub credentials, self-serve deletion switch, production keys into Vercel.
- [ ] Stripe live mode: catalog, webhook, secret key (`docs/billing.md`).
- [ ] Counsel review of /terms and /privacy.
- [ ] Bing Webmaster Tools.

## Waiting on others

- TikTok app review (icon fix done; resubmission pending).
- YouTube quota audit, submitted 12 Sep. Until it clears, all users share ~6 uploads a day.

## Sources for the policy and rate claims

- TikTok, Integrity and Authenticity: https://www.tiktok.com/safety/en/policies-and-engagement/integrity-authenticity
- TikTok whitelisting / Spark Ads mechanics: https://insense.pro/blog/tiktok-whitelisting
- UGC creator rates 2026: https://influee.co/blog/ugc-price · https://joinbrands.com/blog/ugc-creator-rates/
