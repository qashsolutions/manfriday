# Environment variables — Man Friday

Wiring map for every service. **Names and placeholders only — real values never go in git.**
Vercel holds only what the Next.js frontend needs; secrets live in Convex (server actions)
and Railway (render worker). Fill each dashboard as its milestone arrives.

## Vercel (Project → Settings → Environment Variables)

| Variable | Value from | Needed by |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Convex dashboard → project URL | M2 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API keys | M2 |
| `CLERK_SECRET_KEY` | Clerk dashboard → API keys | M2 |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/login` (literal) | M2 |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/signup` (literal) | M2 |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project settings | M2 |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` (or EU host) | M2 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe dashboard → API keys | M4 |
| `NEXT_PUBLIC_SITE_URL` | `https://manfriday.app` (literal) | M0 (SEO: canonical URLs, sitemap, OG) |

Axiom: no env var — install the **Axiom Vercel integration** (log drain) from the Vercel marketplace.

## Convex (Dashboard → Settings → Environment Variables)

| Variable | Value from | Needed by |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | M1 (call sites 1 + 2) |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk → JWT template "convex" | M2 |
| `CLERK_WEBHOOK_SECRET` | Clerk → webhooks (user sync) | M2 |
| `TIKTOK_CLIENT_KEY` | developers.tiktok.com app | M3 |
| `TIKTOK_CLIENT_SECRET` | developers.tiktok.com app | M3 |
| `GOOGLE_CLIENT_ID` | GCP → OAuth client (YouTube Data API enabled) | M3 |
| `GOOGLE_CLIENT_SECRET` | GCP → OAuth client | M3 |
| `STRIPE_SECRET_KEY` | Stripe → API keys | M4 |
| `STRIPE_WEBHOOK_SECRET` | Stripe → webhook endpoint (Convex HTTP action URL) | M4 |
| `RESEND_API_KEY` | resend.com (+ DNS records on manfriday.app) | M4 |
| `WORKER_TOKEN` | self-minted (`openssl rand -hex 32`) — authenticates the Railway worker's long-poll | M1 |

## Railway (Service → Variables)

| Variable | Value from | Needed by |
|---|---|---|
| `CONVEX_URL` | Convex project URL (same as `NEXT_PUBLIC_CONVEX_URL`) | M1 |
| `WORKER_TOKEN` | same self-minted value as Convex's | M1 |
| `FAL_KEY` | fal.ai dashboard | M1 |
| `ANTHROPIC_API_KEY` | console.anthropic.com (batch pre-generation) | M1 |
| `AXIOM_TOKEN` | Axiom → API tokens | M1 |
| `AXIOM_DATASET` | e.g. `manfriday-worker` | M1 |

## Later / optional (adapters exist before the accounts do)

| Variable | Service | When |
|---|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs — premium multilingual TTS (D6) | when voice-quality feedback demands it |
| `SARVAM_API_KEY` | Sarvam AI — Hindi/Indic TTS (D6, India fast-follow) | India launch |

## Long-lead applications (start immediately, not env vars)

- TikTok **Content Posting API audit** — until approved, publishing uses draft-to-inbox fallback.
- YouTube **Data API quota increase** — default is ~6 uploads/day across ALL users.
- Set **spending caps** in Anthropic + FAL dashboards before M1 first runs.
