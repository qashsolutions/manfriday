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
| 4 Oct | Scale comes from languages × platforms × genuine accounts, plus paid creators | What the data on breakout posts actually shows working |
| 4 Oct | Screen-recording b-roll ranks above the discovery features | 14 of 16 breakout posts show a face next to moving software; we can produce neither |
| 4 Oct | Pricing unchanged at $20/$40 | We already undercut the category; creator payouts come from the Founding 200 offer instead |
| 16 Sep | Every feature must answer "what does the user get" | Standing product rule |

## Open questions

- Budget for paid UGC creators? At market rates, 5 creators × 2 videos ≈ $1,500–$3,000.
- Which market after English: Brazil, Indonesia or Spanish Latin America?
- Does the friend's Highway project need a home on GitHub, or is the local bundle enough?

## Running notes

- 4 Oct: repo had been overwritten by another project; Man Friday restored, Highway bundled to `~/backups/highway-20261004.bundle`, Vercel reconnected.
- 4 Oct: vidIQ credits 68, refresh to 150 on 8 Oct. Phase 4 study needs ~100.
- 4 Oct: verified live — pipeline, worker, publishing, stats cron, billing, compliance, 63 + 18 tests green.
