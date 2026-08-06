---
name: ui-verify
description: Use whenever verifying any webapp UI change — taking screenshots, checking 1440px/390px widths, light/dark theme checks, or critiquing screens against webapp/DESIGN.md. Load BEFORE starting the dev server or capturing any screenshot; this is the required "done" procedure for all UI work.
---

# ui-verify — the UI verification loop

Every UI change is proven the same way: serve → capture → critique → report.
Follow the steps in order. The design bar is `webapp/DESIGN.md`; the session
rules are CLAUDE.md — this skill implements them, it does not replace them.

## 1. Dev server

- Probe first: `lsof -nP -iTCP:3000 -sTCP:LISTEN`.
- **Something already listening on :3000** → use it read-only. Do NOT kill,
  restart, or reconfigure it — it is not yours.
- **Port free** → start the server yourself from `webapp/`
  (`npm run dev`, background), record the PID, and wait until :3000
  responds before capturing.
- At the end of the session, kill ONLY the PID you started. If you started
  nothing, kill nothing.

## 2. Capture

- Use **headless Chrome CLI** — never a driven browser tab for public
  pages, so a signed-in profile can never contaminate the shots:

  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless --disable-gpu --screenshot=<scratchpad>/<screen>-1440.png \
    --window-size=1440,2400 http://localhost:3000/<route>
  ```

- Every changed screen at **1440px and 390px** widths, full page (set the
  window height tall enough to include the whole page; re-shoot taller if
  content is cut off).
- Save into the **session scratchpad only** — screenshots never land in
  the repo.
- If the change touches theme code (tokens, `globals.css` theme blocks,
  anything theme-sensitive), capture **both light and dark** at both
  widths.
- Exact narrow widths require headless: the driven browser clamps at
  roughly an **808px minimum** window. For signed-in narrow states that
  headless cannot reach, capture at the driven browser's minimum, state
  the actual measured width in the report, and verify the app's narrow
  breakpoint has engaged in the shot.

## 3. Signed-in states

- **NEVER enter credentials** — not into forms, not via scripts, not from
  env files.
- If signed-in screens are needed: ask the user to sign in once in the
  driven tab, then capture from that tab (width caveat from step 2
  applies).
- If the user can't sign in now: capture the signed-out set and list the
  signed-in shots under **blocked-on** in the report. Do not fake, mock,
  or bypass auth to get them.

## 4. Critique

- Open and **LOOK at every image** with the Read tool — no exceptions,
  no "capture succeeded so it's fine".
- Grade each shot against `webapp/DESIGN.md` — especially **§14 the
  anti-checklist**, plus §13 (required designed states) and §15 (quality
  floor). Check for horizontal overflow at 390px and dark-theme
  regressions explicitly.
- **Iterate at least twice**: critique → fix → re-capture → re-critique,
  before calling the work done. Keep the final set of screenshots.

## 5. Report

- Cite the **final screenshot paths** (scratchpad paths) in the session
  report.
- When layout changed, state the **measured width** of the narrow shots
  (390px headless, or the actual driven-browser minimum if that fallback
  was used).

## Environment limitation — local vs deployed

API keys (`ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, OAuth secrets) live only
in the Vercel deployment; analyst runs, YouTube connect, and other
server-key features may be unconfigured on localhost. Capture
**render-level evidence** locally (layout, states, copy, empty/loading/
error framing). List **behavior-level checks** (live analyst output,
OAuth flows, API-backed data) as post-deploy verification for the user's
live pass on manfriday.app — report this as a handoff item, never as a
failure.
