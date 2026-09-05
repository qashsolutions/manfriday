# File hierarchy — Man Friday monorepo

One repo, three runtimes: the **Next.js app** (Vercel), **Convex** (DB + server actions +
scheduler), and the **Python render worker** (Railway). Structure follows the four contracts
in Friday Internals; every route maps to one of the 9 design artboards.

```
manfriday/
├── app/                              # Next.js App Router (Vercel)
│   ├── (marketing)/                  #   public, static-first — SEO surface
│   │   ├── page.tsx                  #   Landing            ← Main.dc.html
│   │   ├── pricing/page.tsx          #   Pricing (D5: $20/$50/$150/$200-3yr)
│   │   ├── blog/
│   │   │   ├── page.tsx              #   Blog index (growth hook 1)
│   │   │   └── [slug]/page.tsx       #   Post page (MDX render + metadata)
│   │   ├── tools/                    #   Free calculators (M4 SEO doors)
│   │   │   └── [calculator]/page.tsx
│   │   ├── privacy/page.tsx
│   │   └── terms/page.tsx
│   ├── (auth)/
│   │   ├── signup/page.tsx           #   Signup             ← Signup.dc.html (Clerk in M2)
│   │   └── login/page.tsx
│   ├── (app)/                        #   authed shell, left-rail layout (M2+)
│   │   ├── layout.tsx                #   rail: Picks · Calendar · Analytics · Settings
│   │   ├── onboarding/page.tsx       #   Friday's first day ← Onboarding.dc.html
│   │   ├── picks/page.tsx            #   swipe feed         ← Picks.dc.html (mobile-first)
│   │   ├── editor/[conceptId]/page.tsx #  light editor      ← Editor.dc.html
│   │   ├── calendar/page.tsx         #   Friday's queue     ← Calendar.dc.html
│   │   ├── analytics/page.tsx        #   plain stats        ← Analytics.dc.html
│   │   └── settings/page.tsx         #   account·MFA·billing·accounts ← Settings.dc.html
│   ├── l/[slug]/route.ts             #   tracked-link edge redirect (learning loop, M4)
│   ├── api/og/route.tsx              #   dynamic OG images (blog + landing)
│   ├── sitemap.ts · robots.ts        #   SEO plumbing
│   ├── feed.xml/route.ts             #   blog RSS
│   └── layout.tsx · globals.css
├── components/
│   ├── marketing/                    #   Hero, SwipeStrip, HowItWorks, ProofBand,
│   │   └── …                         #   FoundingOffer, BookACall, Header, Footer
│   ├── app/                          #   PickCard, SwipeDeck, QueueSlot, StatTile… (M2)
│   └── ui/                           #   Button, Chip, Panel, MonoLabel — Broadcast primitives
├── content/
│   └── blog/*.mdx                    #   one file per post — daily publish = drop file, push
├── lib/
│   ├── tokens.css                    #   Broadcast design tokens (single source of truth)
│   ├── seo.ts                        #   metadata builders, JSON-LD
│   └── pricing.ts                    #   D5 terms — one const, imported everywhere
├── convex/                           # Convex (schema from Friday Internals contract 1)
│   ├── schema.ts                     #   users…quotaCounters + voiceEdits/trackedLinks/linkClicks
│   ├── brands.ts                     #   call site 1 (Opus brief) — M1
│   ├── concepts.ts · renderJobs.ts   #   generation + queue — M1
│   ├── worker.ts                     #   long-poll endpoint (WORKER_TOKEN auth) — M1
│   ├── publish/                      #   contract 3: adapter.ts, tiktok.ts, youtube.ts — M3
│   ├── billing.ts                    #   Stripe + Founding-1000 counter — M4
│   ├── crons.ts                      #   publish scan, metrics cadence, batch pre-gen
│   └── http.ts                       #   webhooks (Clerk, Stripe)
├── worker/                           # Python render worker (Railway) — M1
│   ├── main.py                       #   long-poll loop, claim/heartbeat
│   ├── pipeline/
│   │   ├── scrape.py                 #   trafilatura/OG/JSON-LD (deterministic)
│   │   ├── match.py                  #   tag-scoring trend match (no embeddings)
│   │   ├── slots.py                  #   call site 2 (Haiku, batched, structured, language-aware)
│   │   └── lint.py                   #   templateSpec v1.1 lint ← validation/template-spec/
│   ├── render/
│   │   ├── slideshow.py · hook.py · avatar.py   # ← validation/template-spec/render.py, split
│   │   ├── tts.py                    #   TTSAdapter: FAL now; ElevenLabs/Sarvam later (D6)
│   │   └── style_tokens.py           #   brand palette → concrete type/colors
│   ├── requirements.txt · Dockerfile
│   └── tests/
├── design/                           # 9 artboards + canvas.json (design source of truth)
├── docs/                             # plan, internals, this file
├── validation/template-spec/         # spec v1.1 validation (seed code for worker/render)
└── vercel_var.md                     # env wiring map
```

## Design → code mapping check

| Artboard | Route | Status |
|---|---|---|
| Main (Landing) | `/` | M0 — building now; pricing copy updated to amended D5 |
| Signup | `/signup` | M0 shell now, Clerk wiring M2 |
| Onboarding | `/onboarding` | M2 |
| Picks | `/picks` | M2 |
| Light editor | `/editor/[conceptId]` | M2 |
| Calendar | `/calendar` | M3 |
| Analytics | `/analytics` | M4 |
| Settings | `/settings` | M2 (MFA) · M3 (connected accounts) · M4 (billing) |
| Prototype | — (design reference only) | n/a |

Gaps found in the compare (now covered above): the design has no blog/pricing/legal pages
(growth hooks + Clerk/Stripe compliance need them — M0 builds them in Broadcast style), and
no tracked-link redirect surface (it's chromeless — `l/[slug]` route only).

## Security posture (baked into the layout)

- OAuth tokens + API secrets exist only in `convex/` actions and `worker/` env — never in
  `app/` or the browser bundle (`NEXT_PUBLIC_*` is the only browser-visible prefix).
- The worker authenticates to Convex with a self-minted `WORKER_TOKEN`; no inbound ports.
- Publish adapters are the only code that knows platform APIs (contract 3).
- Webhooks verified by signature (Clerk, Stripe) in `convex/http.ts`.
- The swipe is the moderation gate: nothing publishes without a right-swipe (plan, risks).
