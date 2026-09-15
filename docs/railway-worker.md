# Render worker on Railway — runbook (13 Sep 2026)

The worker (`worker/`) long-polls Convex `renderJobs` + `pipelineRequests`, renders with Pillow + ffmpeg,
calls Claude (brief + slot-fill), FAL (English TTS, lipsync) and Sarvam (Indic TTS), and uploads results to
Convex storage. It is stateless: N replicas are safe (each claims jobs under its own `WORKER_ID`).

## One-time setup in the Railway dashboard

1. **New Project → Deploy from GitHub repo** → `qashsolutions/manfriday`, branch `main`.
2. Service **Settings → Source → Root Directory**: `worker`. Railway detects `worker/Dockerfile` and builds it
   (build ≈ 3 min: ffmpeg + fonts are baked into the image).
3. **Settings → Deploy**: Restart policy "On failure", replicas 1 (raise to 2–3 when the queue backs up; no code change needed).
   No public networking — the worker makes outbound calls only.
4. **Variables** (all required unless noted):

   | Variable | Value / where it comes from |
   |---|---|
   | `CONVEX_URL` | `https://artful-fly-951.convex.cloud` (the deployment serving manfriday.app) |
   | `WORKER_TOKEN` | same value as the Convex env var `WORKER_TOKEN` (Convex dashboard → Settings → Environment variables) |
   | `ANTHROPIC_API_KEY` | Anthropic console — the worker runs the two Claude call sites (brand brief, slot-fill) |
   | `FAL_KEY` | fal.ai dashboard — English TTS (ElevenLabs via FAL) + lipsync |
   | `SARVAM_API_KEY` | Sarvam dashboard — Indic TTS (Bulbul v3) |
   | `TTS_PROVIDER` | `fal` (already set in the Dockerfile; override only for experiments) |
   | `FAL_TTS_VOICE` | `Rachel` (Dockerfile default) |
   | optional | `FAL_TTS_STABILITY`, `FAL_TTS_STYLE`, `FAL_TTS_SPEED`, `SARVAM_SPEAKER`, `SARVAM_PACE` — code defaults apply |

   Never put these in the repo; `.env.local` is gitignored and is the local equivalent.
5. **Deploy.** Logs must show `worker <host>-<id> polling …` and NOT the line
   `WARNING: Pillow has no libraqm` (the Dockerfile asserts raqm at build time, so a missing-raqm image never ships).

## Verify after the first deploy

- Convex dashboard → Data → `renderJobs`: `claimedBy` on new jobs shows a Railway hostname instead of the iMac.
- Kick a job: `npx convex run dev:rerenderConcept '{"conceptId":"<a rendered concept id>"}'` and watch it complete.
- Then stop the iMac worker (`pkill -f "main.py"`), otherwise two workers compete (harmless but confusing in logs).

## Redeploys

Every push to `main` that touches `worker/**` redeploys automatically (Railway watches the root directory).
Convex functions deploy separately (`npx convex dev --once` / `npx convex deploy`), Next.js via Vercel.

## Local build check (needs Docker Desktop)

```
docker build -t mf-worker worker && docker run --rm --env-file .env.local mf-worker python main.py --once
```
