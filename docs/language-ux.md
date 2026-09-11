# Language UX — spec

> **Status 11 Sep 2026:** §1 (chip + combobox + how-it-sounds on the brief and in Settings), §2 (per-pick language, "also in" sheet → `feed.requestVariant`), §3 (schema fields), the worker's `generate_variant` (re-slot-fill in the target language/style, straight to final render), and §4's Sarvam Bulbul adapter with silence-based caption alignment are BUILT (Hinglish sample verified 11 Sep). Not yet built: analytics by language (§5); brand-voice defaults per language still to be picked from the shortlist. The variant path needs one end-to-end run against the worker before beta.

Design approved 10 Sep 2026 (artboards: `LanguagePick.dc.html`, `PicksAlsoIn.dc.html`, and the "One pick. Every market" band on `LandingV2.dc.html`). Extends D6 (CLAUDE.md). Principle: **language is detected, then multiplied — never configured.**

## 1. Setup: the brief

- Friday infers `language` (and, for Indic languages, `style`) during brand-brief synthesis from the site's text. It is shown on the brief as a **chip**: native name · English name · `FRIDAY'S PICK` badge.
- The chip is a **command-menu combobox** (cmdk pattern): click/Enter opens a popover anchored under the chip with a type-ahead input. Matching is on native name, English name, ISO code, and common aliases (`bahasa` → Indonesian, `hinglish` → Hindi+code-mixed). Arrow keys move, Enter picks, Esc closes. Footer: `↑↓ MOVE · ↵ PICK · ANY SCRIPT` / `14 LANGUAGES · EVERY PLAN`.
- **Never** a native `<select>`, a dropdown list, or a modal grid — anywhere in the product. The Settings page language `<select>` is removed; Settings links to the brief instead ("Friday writes and speaks in हिन्दी · Hinglish — change in your brief").
- **How it sounds** (Indic languages only, beside the chip): segmented control `Hinglish` / `शुद्ध हिन्दी` / `Roman script` (labels are per-language: Tanglish, Benglish, …). Default = Friday's inference (code-mixed for most consumer/SaaS sites in India). Non-Indic languages hide the control.

## 2. Point of use: the pick

- Every concept carries `language` + `style`; the Picks card shows a small chip (`हिन्दी · HINGLISH`).
- After a **keep** (right swipe), a bottom sheet appears once per pick: *"Post this one in another market too?"* with up to 3 suggested languages (from the brief's audience/markets; the brand's primary language is excluded) as large native-script tiles, an `Other language` search (same combobox), and two actions: `Just <primary>` / `Add <picked> →`.
- Each added language creates a **variant concept** (`variantOf` = the kept concept) that is re-slot-filled in that language (not word-for-word translated), re-voiced, re-rendered, and scheduled as its own post. **Each variant counts as one video** against the plan allowance; the sheet says so.
- The sheet can be dismissed per pick; a brand-level "don't ask again" lives in the sheet's overflow, not in Settings.

## 3. Data model (Convex)

- `brands`: `language: string` (BCP-47 from the launch set), `languageStyle?: "code-mixed" | "native" | "roman"`, `markets?: string[]` (suggested "also in" languages, inferred from the brief, user-editable).
- `concepts`: `language`, `languageStyle?`, `variantOf?: Id<"concepts">`.
- `publications` and analytics keep `language` denormalised so "clicks by language" is a plain group-by.

## 4. Pipeline

- **Slot-fill** (Claude Opus, structured output): prompt carries `language` + `style`; for code-mixed, instruct Hinglish/Tanglish register explicitly with two examples; hashtags follow the language.
- **TTS adapter**: FAL multilingual for non-Indic; **Sarvam Bulbul v3** for `hi bn ta te mr kn ml gu pa or` + `en-IN` (30+ voices; `enable_preprocessing=true` for code-mixed; max 2,500 chars). Sarvam Mayura (`mode=code-mixed`, `output_script`) is used only when a variant is derived from an existing script rather than re-slot-filled.
- **Caption timing** (built 11 Sep, `worker/render/tts.py`): Bulbul returns no word timestamps, and Saaras STT returns ONE timestamp per clip (tested — useless for captions). The adapter aligns deterministically instead: the script's punctuation defines sentences and clauses; ffmpeg `silencedetect` finds the pauses the voice leaves at that punctuation; sentence ends snap to the nearest pause (±1.2 s), clauses split their sentence's span at an inner pause (±0.6 s) or proportionally; words pace proportionally inside a clause. No model, no vendor timestamps, zero cost. Router: `get_tts()` sends the Indic ten to Sarvam whenever `SARVAM_API_KEY` is set (`TTS_INDIAN_ENGLISH=1` adds en-IN); everything else keeps the FAL/say provider. Speaker per language via `SARVAM_SPEAKER_<code>` (default `shubh`).
- **Cost**: a variant is ~1 slot-fill batch share + TTS + render; no extra brief. Track `costCents` per variant like any concept.

## 5. Analytics

- Analytics gains a `by language` split on clicks (not views). "More like this" is language-aware: winners are re-drafted in the language that won.

## 6. Landing page

- The "One pick. Every market you sell to." band demos §2 with three cards of one hook (Hinglish / Español / Bahasa Indonesia). Copy promises "rewritten and voiced, not translated word for word".

## Open questions

- ~~Which Bulbul voices per language become the "brand voice" defaults~~ → decided 11 Sep: **priya** default, **kavya** female alt, **rahul** male alt (all languages; refine per language from user feedback).
- Whether `roman` script output should also transliterate on-screen captions or only the TTS text.
- Allowance display: show variants as `+1` in the plan meter at creation time or at render time (decide with billing in M4).
