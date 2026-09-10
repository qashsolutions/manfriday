# Landing v2 — spec

Design approved 10 Sep 2026 (artboards: design canvas → page "Landing v2 + home": `LandingV2.dc.html`, `LandingV2Mobile.dc.html`). This document is the build contract for `app/(marketing)/page.tsx` and `components/marketing/*`.

## Why v2

v1 described the product; it never showed it. The north-star differentiator (click attribution: "see which post sent people to your product") was absent, the swipe strip was grey placeholder cards, and the stats band shipped bracketed placeholders to production. v2 fixes all four and turns the hero into the first step of the free tier.

## Page anatomy (top to bottom)

1. **Header** — logo · Blog · Pricing · Log in · **Start free** (accent pill). Unchanged.
2. **Hero** — eyebrow `A CONTENT SIDEKICK FOR SOLO BUILDERS` · H1 `You build. / Friday posts.` · sub (≤ 3 lines) · **URL input row** (`https://yourproduct.com` + accent button `Friday, read my site →`) · fine print `Free · no card · your brand brief in about 30 seconds`.
   - The input is the primary call to action. Submitting goes to `/signup?url=<encoded>`; account creation stays step 1 (D4), and the onboarding brief pre-fills from the query param. No anonymous brief in v1 (cost + abuse).
   - Client-side: trim, prepend `https://` if missing, reject obvious non-URLs inline (no alert dialogs).
3. **Live Picks demo** — chip `LIVE PICKS · WHAT FRIDAY MADE FOR LOOPNOTE THIS MORNING` · two 9:16 cards side by side: **trend reference** (left, neutral) → arrow `SAME FORMAT / YOUR PRODUCT` → **Friday's pick** (right, accent ring, glow) · legend `← SKIP · 3 OF 10 TODAY · KEEP — FRIDAY POSTS IT →`.
   - v2.0 ships static cards (real hooks from the M1 sample brand). v2.1: the right card auto-cycles through 3 picks every ~6s with a swipe-out animation; respects `prefers-reduced-motion`.
   - Never generative imagery: card backgrounds are gradients/brand screenshots (determinism-first).
4. **Click attribution** (dark band `#100F15`) — eyebrow (mint) `THE ONLY NUMBER THAT PAYS RENT` · H2 `See which post sent people to your product.` · sub · two cards: **post card** (thumb, LIVE·TIKTOK chip, caption with `manfriday.app/l/<slug>`, VIEWS / WATCHED / **CLICKED TO <product>** highlighted mint) and **this week by clicks** (5 bars, total, Friday's note about making more of the winner).
5. **How it works** — three tiles, each with a *visual* block (brief mock · tilted swipe cards · calendar rows with LIVE/QUEUED chips) above title + 2-line body. Replaces the icon-only tiles.
6. **One pick. Every market you sell to.** — eyebrow `ANY LANGUAGE · EVERY PLAN` · three cards of the same hook (हिन्दी/Hinglish accent-ringed, Español, Bahasa Indonesia) · the 14 language names in their own scripts as plain text · mono footnote `14 AT LAUNCH · INDIAN VOICES BY SARVAM · THE CATEGORY LEADER GATES THIS AT $149/MO`.
7. **Founding 200** — the single offer card (no companion card). Feature list now includes `Tracked links — see which post sent people to you`.
8. **Footer** — unchanged.

Removed from v1: `SwipeStrip` (replaced by 3), `ProofBand` (bracketed stats; returns only when beta numbers exist, as real numbers).

## Copy rules

- Friday is personified; never gendered. Lead with clicks, never raw views.
- Sample product on the marketing site is **Loopnote** (fictional). Sample numbers (41 clicks, 113/week, 12.4K views, 61%) are illustrative and stay constant.
- No competitor names. "The category leader" only.

## Responsive

- ≤ 720px: hero stacks (input above button, both full width); demo stacks reference-small/pick-large side by side at 104/168px; attribution cards stack; language cards two-up; founding card full width.
- No horizontal scroll at 390px. Headline 42px on phone.

## Build notes

- Components: `Hero` (rewrite: adds `UrlCta` client component), `PicksDemo` (new, replaces `SwipeStrip`), `Attribution` (new), `HowItWorks` (add visual blocks), `Markets` (new), `FoundingOffer` (feature copy tweak). Delete `ProofBand`, `SwipeStrip`.
- All tokens from `app/globals.css`; light mode must hold (site-wide light mode shipped 9 Sep) — check every new colour has a light-mode counterpart via the existing variables.
- SEO: unchanged metadata; the new H2s are real headings.

## Acceptance

- [ ] Lighthouse a11y ≥ 95; URL input labelled; cards are `article`s with headings.
- [ ] Phone width: no overflow; hero button reachable without scroll on a 844px viewport.
- [ ] Light + dark both reviewed.
- [ ] `/signup?url=` round-trips into the onboarding brief.
