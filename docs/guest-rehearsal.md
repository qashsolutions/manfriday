# Guest rehearsal — the first guest's journey, done by us first

Purpose: walk the real guest flow on manfriday.app before a friend does, trying
both what should work and what should be refused. You drive the browser (it
needs your inbox, passkey/2FA and YouTube); Claude checks the database after
each step and records the result here.

Setup: a private/incognito window (so your operator session isn't used), the
invite link Claude creates (not emailed), and a YouTube channel you own.
Uploads go up as **private** videos, so nothing becomes public.

| # | You do | Should happen | Claude checks |
|---|--------|---------------|---------------|
| 1 | Open the invite link, sign up with the invited address | Lands in the app; rail chip `GUEST · 25 OF 25 LEFT · ENDS <date 21 days out>` | users row: `guestExpiresAt` ≈ now + 21 d, `videoGrant` 25; parked invite consumed; slot count unchanged |
| 1b | **Refuse:** open the same invite link again | No second account; sign-in or "already used" | still one users row for the address |
| 2 | Onboarding: enter a real product URL (not used before) | Brief written, language chip shown, previews arrive within ~3 min | pipelineRequest done; brand brief from a real scrape + Claude; 10 preview concepts |
| 3 | Picks: skip one, then keep one | Skip costs nothing; keep → `24 OF 25`, the "also in" sheet appears (close it) | creditLedger: one charge; final render job done; concept rendered |
| 4 | **Refuse:** Settings › Connected accounts › Connect YouTube without a passkey or 2FA | The button is replaced by "add a passkey or two-factor first" | no socialAccounts row |
| 4b | (Claude) | Server refuses even if the button is bypassed | already covered by tests/convex/connect-gate.test.ts; Claude confirms no connect slipped through |
| 5 | Add a passkey (or 2FA) under Security, then Connect YouTube | "YouTube connected" | socialAccounts row for the guest; tokens not visible anywhere in the app |
| 6 | Calendar: the kept video is booked for 17:30 awaiting approval. Approve it (or Schedule it a few minutes out) | Posts at its time as a private video on your channel; Calendar shows it posted | publication succeeded; YouTube video ID stored; quota counter moved by 1,600 |
| 7 | **Refuse:** (Claude lowers this guest's allowance to what's used) then try to keep another pick | The out-of-videos sheet; nothing renders, skip still works | no new charge, no new render job |
| 8 | Press "Something wrong?" anywhere, write a line, Send | "Got it" | feedback row with screen + device; alert email to admin; visible in /admin |
| 9 | Settings › Your data › Delete account | Signed out | every row and file for the guest gone; YouTube grant revoked (check myaccount.google.com/permissions); Clerk user gone; slot freed (back to 1 of 10) |

Not in this pass: the 60-minute idle logout (long wait; check separately),
TikTok (sandbox only until the audit clears), Stripe checkout (test catalog
left as is), the automatic 21-day deletion (covered by tests with a stand-in for
Clerk; step 9 deletes the sign-in from the browser, not through the server's
expiry path).

## Results

_Filled in as we go._
