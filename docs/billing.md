# Billing runbook (Stripe, M4)

Built 16 Sep 2026. Stripe account: **Qash Solutions, Inc.** Test mode (sandbox) is wired; live mode is not.

## How it works

| Piece | Where |
|---|---|
| Prices, derived from `lib/site.ts` | `lib/billing-catalog.ts` (tests assert they match) |
| Create/verify catalog + billing portal config | `npx tsx scripts/stripe-catalog.ts [--live] [--apply]` (uses the Stripe CLI login; dry run without `--apply`) |
| Video allowance: free 3 once, tier videos per month, top-ups after | `convex/allowance.ts` |
| Checkout, portal, pause, Founding counter, webhook appliers | `convex/billing.ts` |
| Webhook route (signature checked on raw body, idempotent by event id) | `convex/http.ts` → `https://<deployment>.convex.site/stripe/webhook` |
| Stripe REST client (no SDK) | `convex/stripeApi.ts` |
| Nav meter, at-zero sheet, Settings › Plan & billing | `components/app/PlanMeter.tsx`, `OutOfVideosSheet.tsx`, `BillingSection.tsx` |

Rules the code enforces:

- **Plan state is written only by webhooks.** Checkout and the portal are Stripe-hosted; the app never sees a card.
- **A keep costs one video** (and each "also in" variant). At zero the keep opens a choice; skipping and browsing stay free. A render or variant that fails for good gives the video back — unless its month has already reset.
- **Monthly allowances reset on the plan's start day**, no rollover. Top-up videos are used after the monthly ones and keep while the plan is active. Top-ups need a paid plan.
- **Founding 200:** one-time price, three years from purchase, number assigned on payment. Checkout refuses when 200 are taken; two buyers racing for the last spot are both honoured.
- **Pause:** paid plans, 1–3 days, once every 30 days. Subscriptions: the next charge moves out by the paused days (`trial_end`, no proration). Founding: access end moves out. Scheduled posts are held and go out when the pause ends; "Resume now" releases them.
- **Account deletion cancels the subscription at Stripe immediately.**

Lookup keys: `solo_monthly`, `solo_quarterly`, `solo_annual`, `solo_founding_3y`, same for `studio_*`, and `topup_10`.

## Convex environment

| Variable | Test mode (now) | Live (launch) |
|---|---|---|
| `STRIPE_SECRET_KEY` | sandbox secret key — **set by the user in the Convex dashboard** | live secret or restricted key |
| `STRIPE_WEBHOOK_SECRET` | set 16 Sep from endpoint `we_1UGW2zA8a2u3Lccg2VbpINZm` | from the live endpoint |
| `APP_URL` | unset → `https://manfriday.app` | unset |

Never paste keys into chat or commit them.

## Test a purchase (sandbox)

1. Settings › Plan & billing › pick a price. Card `4242 4242 4242 4242`, any future date, any CVC.
2. Back on Settings the plan switches within seconds (webhook). The nav meter shows the new allowance.
3. Failed payment: card `4000 0000 0000 0341` on a subscription, then check the payment-failed notice.
4. Re-sent events are safe: `stripeEvents` makes each apply exactly once.

## Go live checklist

0. **Public business name and branding** on the Stripe account still say Denali Health — Checkout, the portal, receipts and card statements show it. Change them (Settings › Business › Public details, Branding) or move Man Friday to its own Stripe account.

1. Live mode needs write access: the `stripe login` live key is read-only. Either grant Prices/Products/Portal/Webhook write on that key for the session, or create the live catalog from a live restricted key.
2. `npx tsx scripts/stripe-catalog.ts --live` (dry run), then `--live --apply`.
3. Create the live webhook endpoint (same 7 events as test) and put its secret in the production Convex deployment.
4. Set `STRIPE_SECRET_KEY` (live) in the production Convex deployment.
5. Decide Stripe Tax: prices are tax-exclusive; turning on automatic tax at Checkout needs the origin address and registrations set up in Stripe first.
6. One real $5 top-up on a paid account, then refund it from the Dashboard.
