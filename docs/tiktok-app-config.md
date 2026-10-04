# TikTok developer app — canonical config

App: **Man Friday**, ID `7683180632180279303`, portal account qash.dallas@gmail.com.
Sandbox: **"Man Friday Test"**, ID `7683193682031429650` (creds = the `sb`-prefixed pair in `.env.local`).

## ⚠️ Why this file exists

TikTok's portal will **not save the Production draft until a demo video is uploaded**
("Please upload at least one video" blocks Save, not just Submit). Any config typed
without the video is silently lost on navigation — this wiped our 5–7 Sep setup once
already. **Fill the entire production form in ONE sitting, video included**, from the
values below. The Sandbox has no such rule (Apply changes works) and is already saved.

## Form values (both Production and Sandbox)

| Field | Value |
|---|---|
| App icon | `design/manfriday-icon-1024.png` — the SAME artwork as the site favicon (`app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`, generated from this file). TikTok rejected the 4 Oct update because the site served no favicon; they check the app icon against the website and browser tab. Never let these drift. |
| App name | Man Friday |
| Category | Business |
| Description | Man Friday turns your product's website into short videos you schedule and post to TikTok. You build. Friday posts. |
| Terms of Service URL | https://manfriday.app/terms |
| Privacy Policy URL | https://manfriday.app/privacy |
| Platforms | Web only |
| Web/Desktop URL | `https://manfriday.app/` — **trailing slash required**; without it the field fails "URL not verified" against the verified URL-prefix property |

Domain verification: URL-prefix property `https://manfriday.app/` is verified and persists
(signature file `public/tiktok Xt64z…​.txt` lives in the repo and is live).

## Products & scopes

- **Login Kit** — redirect URI (Web): `https://manfriday.app/api/oauth/tiktok/callback` → grants `user.info.basic`
- **Content Posting API** — **Direct Post toggle ON** → grants `video.upload` + `video.publish`
- Domain "Verify" inside Content Posting is only for pull_by_url — we push by file; skip.

## Review explanation (paste into "Explain how each product and scope works", 891 ch)

Man Friday (manfriday.app) is a web app that helps solo founders turn their product's website into short marketing videos, then schedule and publish them to their own TikTok account.

Login Kit (user.info.basic): users connect their TikTok account on our Settings page. We show the connected account's display name and avatar so users can confirm which account Friday posts to.

Content Posting API (video.upload, video.publish): from the app's Calendar, users pick a video they created and schedule it. At the scheduled time our server uploads that video. video.upload delivers it as a draft to the user's TikTok inbox for final review in the TikTok app; video.publish enables direct posting of the user's scheduled content at the time they chose. Users only ever post their own videos to their own connected account, and nothing is posted without an explicit scheduling action by the user.

## Demo video requirements (from the form)

mp4/mov, ≤50 MB, max 5 files. Must be recorded against the **Sandbox**, show manfriday.app
(domain must match the Web URL), show the full flow: Settings → Connect TikTok → TikTok
authorize screen → back with handle shown → Calendar → schedule → draft arriving in the
TikTok app inbox. All selected products/scopes must appear in the video.

## Credential environments

- Production pair: `TIKTOK_CLIENT_KEY_PROD` / `TIKTOK_CLIENT_SECRET_PROD` in `.env.local`. Useless for OAuth until the review is approved.
- Sandbox pair (active): `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` in `.env.local` **and Convex env** — Convex is what `convex/oauth.ts` reads. After audit approval, swap the `_PROD` values back into both.
- Sandbox OAuth only works for accounts added under Sandbox settings → Target Users.

## Demo video — recorded 10 Sep 2026 (`docs/tiktok-demo.mp4`, gitignored)

Recipe, for a re-take:
- `ffmpeg -f avfoundation -i "4:none"` (device 4 = Capture screen 0; needs Screen Recording permission for Terminal — relaunch Terminal after granting). Chrome window at bounds `{204,30,1715,1001}`, crop `3004:1616:418:300` → 1920×1032, then a further 82px off the top to drop Chrome's "Claude started debugging this browser" bar.
- Drive the tab in the ✅Claude MCP tab group — and make sure THAT tab is the active one on screen (an identically titled user tab was recorded by mistake once).
- Mac: Do Not Disturb on. TikTok consent screen only reappears if the user removes the app in the phone app (Settings and privacy → Security & permissions → Apps and services; web settings has no such page) — `oauth.disconnect` now also calls TikTok's revoke endpoint.
- Worker wait (schedule → inbox) is ~2 min; sped up 10× in the cut. Final beat: `./check-tiktok-status.sh` in a Terminal window over the calendar (font 20, bounds `{430,290,1490,830}`).

Production draft was saved on 10 Sep with everything above but **Direct Post OFF** (video.upload only — the sandbox demo cannot show direct posting; add video.publish in a later revision). **Submitted for review 10 Sep 2026 11:37** with the note: "First submission for Man Friday, a web app for solo founders so they connect their tiktok accounts for content posting." Status shows "in review"; review comments land in History → Review comments on the app page.
