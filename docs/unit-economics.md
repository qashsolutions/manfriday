> **Superseded 15 Sep 2026:** the avatar sub-cap is gone (D5 v6). The AI talking head was removed; a presenter video costs the same as a hook video (≈6¢, voice only), so every plan is simply N videos/month. The COGS analysis below is kept for history; worst-case COGS per video is now the hook-video figure.

# Unit economics — pricing limits & margins (v1, 6 Sep 2026)

The visible pricing unit is **videos per month** with an **avatar sub-cap**; credits exist
only as internal metering (creditLedger). These numbers are **provisional estimates** —
the pipeline records real cost per concept (`concepts.costCents`), and M1 telemetry
replaces every estimate here before launch billing (M4).

## Per-video COGS (conservative-high estimates)

| Format | Cost drivers | Est. |
|---|---|---|
| Slideshow | Pillow composition only | ~$0.01 |
| Hook video | TTS ~20s + ffmpeg | ~$0.06 |
| Avatar | lipsync render + TTS | ~$0.55 |
| LLM + storage overhead (all formats) | Opus slot-fill batched/cached/Batch-API, brief amortized, storage/egress | ~$0.04 |

LLM note: slot-fill runs on **Claude Opus** (user directive: ≥ Opus 4.8, never Haiku).
Under determinism-first the model only fills small text slots, so Opus costs ~1–2¢/video —
quality up, still <2% of price.

## Tier margins at the set limits

| | Solo $20 | Studio $40 |
|---|---|---|
| Videos / month | 20 (any mix) | 100 (any mix) |
| Avatar sub-cap | 5 | 15 |
| **Worst-case COGS** (all allowances maxed) | ~$3.40 → **17%** | ~$11.30 → **28%** |
| Realistic (~60% utilization) | ~10% | ~17% |

Both under the <30% COGS target even at full utilization. **The avatar cap is the entire
margin dial** — everything else is pennies.

- **Free tier**: 3 videos one-time, no avatar → worst case ~$0.20/signup. CAC, not COGS.
- **Top-up**: +10 videos (≤3 avatar) for $5 → worst-case COGS ~$1.80 → 36%… acceptable for
  an overage product; revisit with telemetry.
- **Founding 200 (3-yr prepay)**: same monthly allowances at $5.56–8.33/mo effective
  revenue → 40–120% COGS worst-case. Known, capped CAC bet (≤200 accounts, ≤ ~$2/mo bleed
  each at full usage) bought for upfront cash + evangelists.

## Fixed costs (pre-revenue burn)

Convex free→$25 · Clerk free (10k MAU) · Vercel hobby · Railway ~$10–20 · FAL/Anthropic
usage-only · Axiom/PostHog free tiers → **≈ $50/mo** all-in.

## Competitor ladder (checked 6 Sep 2026, screenshots on file)

Their rungs: Free $0 (10 credits) · $29 (20 saves + 250 credits, 1 workspace) ·
$49 (100 saves + 500 credits, 3 workspaces) · $149 (unlimited saves, 2000 credits,
multi-language, 10 workspaces). Our position: **cheaper at every rung** ($20 vs $29,
$40 vs $49), simpler unit (videos, not saves+credits), and **multi-language on every
plan** — which they gate behind $149. We deliberately have no $149 unlimited tier in v1
and no human-UGC marketplace (never).

## Rules

1. No estimate here survives contact with telemetry: recompute this doc from
   `costCents` percentiles after M1's first 100 renders, again before M4 billing.
2. Allowance enforcement is non-negotiable in M4 — it is what makes Founding-200
   exposure capped.
3. Any pricing copy change happens in `lib/site.ts` only; pages derive from it.
