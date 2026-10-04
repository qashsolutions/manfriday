# Man Friday — state of the build, 4 Oct 2026

Everything below was checked against the live systems on 4 Oct, not from notes.
Nothing had changed in the repo since 17 Sep (last commit 9083937).

## Works end to end (verified today)

| Area | Evidence |
|---|---|
| Pipeline: URL → brief → 10 concepts → previews → final render | Queued a render; the Railway worker claimed and finished it in under 20 s. No stuck jobs. |
| Picks: keep, skip, "also in" variants, discard | Convex tests + live data (19 concepts on the founder account) |
| Three formats in 14 languages, Indic shaping via libraqm | 18 worker tests pass |
| Publishing | 2 YouTube posts live; 6 TikTok posts delivered as inbox drafts (all TikTok allows pre-approval) |
| YouTube view counts + tracked-link clicks | Daily cron has run every morning with no gaps, including 4 Oct |
| Billing (Stripe sandbox) | Solo monthly subscription still active; checkout, portal, top-up, pause, Founding counter, webhooks |
| Stripe branding | Account renamed Man Friday; bolt icon, square logo, graphite/accent colours, descriptor MAN FRIDAY |
| YouTube API compliance | `npm run compliance` passes, including live privacy/terms/homepage checks |
| Automated tests | 63 Convex/copy tests, 18 worker tests, all green |

## Known gap in reality, not in code

**No one outside the team has ever used the product.** The only renders are the
founder's. Every "works" above is a single-user result.

## Missing before inviting testers

1. **Favicon / icon consistency.** FIXED 4 Oct: the site served no favicon at all
   (404), which is why TikTok rejected the app update ("icon does not match the
   website"). `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png` now come
   from the same bolt artwork as the TikTok app icon (`design/manfriday-icon-1024.png`).
   TikTok needs a resubmission with that same file.
2. **Beta invites.** No way to let anyone in. Plan: Clerk restricted sign-up +
   Clerk invitations, so Clerk sends the invite email and no extra provider is needed.
3. **Product email.** Nothing is sent, ever: no welcome, no "your videos are
   ready", no failure alert. Needs a Resend account + API key.
4. **A timed fresh-user walkthrough** on an account without the team flag:
   paste URL → keep → schedule → posted, measuring where it stalls.

## Repo + hosting incident, 4 Oct (resolved)

The GitHub repo `qashsolutions/manfriday` had been force-pushed on 29 Sep with a
different project (a friend's "Highway" trading league) that was never meant to
leave their machine. Man Friday's history was gone from GitHub, and Vercel's Git
connection broke as a result — the site kept serving the old build and no push
deployed.

Fixed: Highway's 20 commits bundled to `~/backups/highway-20261004.bundle`
(verified complete) so nothing of the friend's is lost; Man Friday's 104 commits
force-pushed back to `main`; repo description restored; the Vercel connection
re-made and a build triggered. Verified after: icons live, worker renders,
Convex crons unaffected throughout.

## Pending on someone else

- **TikTok app review** — update rejected 4 Oct over the icon; resubmit after the favicon deploy. Posting stays draft-to-inbox until approval.
- **YouTube quota audit** (submitted 12 Sep) — all users share ~6 uploads/day until it clears.

## Needed before launch (not before testers)

- Clerk production instance (Pro plan for passkeys/MFA, own Google + GitHub credentials, deletion switch).
- Stripe live mode: catalog, webhook, secret key (runbook: `docs/billing.md`).
- Counsel review of /terms and /privacy.
- Railway plan confirmation (worker is running; billing not visible from here).
- Bing Webmaster Tools.

## Not built, after testers are in

- Instagram and LinkedIn (Instagram gates the India market — TikTok is banned there).
- "More like this" learning loop.
- Calculator pages and the trending browse/remix page.
- Music bed for slideshows; nightly live smoke test (needs an alert channel).
