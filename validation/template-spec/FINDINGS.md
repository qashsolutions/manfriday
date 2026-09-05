# Template spec validation — findings

**Gate item:** "Template spec validated by hand-producing 3 real posts with it."
**Date:** 4 Sep 2026 · **Verdict: PASS with 3 spec amendments (v1 → v1.1).**

## What was done

Three real posts for Man Friday itself (brand material = the actual design-canvas
artboards, screenshotted via headless Chrome), produced with **zero LLM calls** —
slots hand-filled, everything downstream deterministic Pillow + ffmpeg, exactly the
production shape:

| Post | Template | Format | Output |
|---|---|---|---|
| mf-confession-slideshow | confession-turnaround-slideshow (the spec's worked example, verbatim) | slideshow | 6 × 1080×1920 PNG + post.json |
| mf-consistency-hook | bold-claim-hook-video (authored fresh) | hook_video | 18.6s MP4, TTS VO, paced captions, 4-shot plan |
| mf-hottake-avatar | hot-take-avatar (authored fresh) | avatar | 27.2s MP4, TTS VO, hook overlay, end card |

`lint.py` implements the spec's authoring-time lint verbatim; `render.py` is the
deterministic renderer. Both passes are replayable: `python3 lint.py && python3 render.py`.

## Findings

### F1 — the spec's own worked example fails its own lint (spec bug, fixed in v1.1)
Lint rule 2 says "declared slots are all referenced." The `caption` slot is consumed
by the **publish layer**, not the renderPlan, so every template with a caption fails.
**Amendment:** slots gain `use: "render" | "publish"` (default `render`). Rule 2
becomes: every *render* slot is referenced; a *publish* slot must NOT be referenced.

### F2 — renderPlan shapes for hook_video and avatar were undefined (now authored)
v1 only ever worked the slideshow example. This exercise authored the other two;
propose canonizing these shapes in the spec:
- **hook_video:** `shots[]` where each shot has `holdSeconds` OR `flex: true`
  (exactly one flex shot absorbs the VO duration); `voice {slotRef, tts}`;
  `captions {from, styleToken, position}`; `durationCapSeconds`.
- **avatar:** `character {pick}`; `speech {slotRef, tts, lipsync: "lazy_on_right_swipe"}`;
  `captions`; `overlay {slotRef, styleToken, position, showSeconds}`;
  `endCard {holdSeconds, bg, text}`; `durationCapSeconds`.

### F3 — video timing model was undefined; lint's "≤60s" was uncomputable
**Amendment:** planned duration = Σ fixed holds + script slot `targetSeconds`
(authoring-time bound), re-checked at generation time against the **actual** TTS
duration vs `durationCapSeconds`. Overrun policy: tempo nudge up to 1.08× max,
else drop the concept from the batch — never silently truncate the script.

### F4 — stock(query) has no provider and no failure behavior
**Amendment:** render-time fallback chain `stock → gradient (brand-dark-2)`.
Choosing the stock provider (Pexels et al.) is a pre-M1 open item; renders never
block on it.

### F5 — composition guardrail (worker-side, not spec-side)
Captions can collide with a full-height `brand_screenshot` card (visible in the
hook video's flex shot). Renderer rule: cap screenshot cards at ~52% height when
captions are active on the same shot. Cosmetic; carry into M1 worker.

### F6 — local stand-ins used (none block the spec)
macOS `say` for TTS (no word timestamps → captions paced proportionally by word
count; production paces from FAL timestamps). No licensed-music library locally
(videos render VO-only). Avatar character is a drawn placeholder (lipsync is
FAL-side and lazy by design). Stock = gradient fallback per F4.

### F7 — renderer nit
ffmpeg's concat demuxer repeats the tail frame (+1–2s vs planned duration). The
M1 worker should assemble with exact frame timestamps or clamp with `-t`.

## Ergonomics notes (the point of hand-producing)

- `maxChars` budgets (90 hook / 60 slide / 40 cta / 150 caption) were comfortable
  to write inside and force punchy lines — good defaults, keep them.
- `guidance` strings were sufficient creative direction to write from cold; they
  read like a decent Haiku prompt, which is what they become at call site 2.
- The flex-shot rule made VO/visual sync trivial: script lands its product mention
  exactly as the CTA card cuts in, with no timeline authoring at all.

## Reproduce

```
brew install ffmpeg              # once
python3 lint.py                  # authoring + concept lint
python3 render.py                # renders all three posts into out/
```

Fonts are fetched from Google Fonts (OFL) into `fonts/` — see git history for the
exact URLs. Brand screenshots regenerate via headless Chrome from `design/*.dc.html`.
