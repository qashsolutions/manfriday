# manfriday — webapp design system

This file ships in the repo. It is derived from the shipped code
(`src/app/globals.css`, `src/components/`, `src/lib/team.ts`) and from
CLAUDE.md. Where this document and CLAUDE.md's cardinal rule or copy
checklist disagree, CLAUDE.md wins.

**The rule that governs everything below:** type and spacing in new work
come from the scales in this file — no ad-hoc font sizes, no one-off
spacing values. New UI uses the shared primitives — never re-implement one
inline.

## 1. Personality

A calm, senior analyst team — plain-spoken, evidence-first, zero hype.
Users meet a team of six; never tech jargon. The interface is quiet on
purpose: the product's character lives in what the team shows (receipts,
verdicts, plain words about the user's own numbers), not in decoration.
Boldness is spent in exactly one place (§6, the Receipt); everything else
stays restrained.

## 2. Color tokens

Source of truth: the token block at the top of `globals.css`. Light is the
locked reference theme; **a full dark theme exists in the same file** (the
`prefers-color-scheme` block and `[data-theme="dark"]`) — both themes are
maintained, light is the reference, and any theme-touching work screenshots
both. Never hardcode a hex in a page; if a color isn't a token, it doesn't
ship.

| Token name | Light | Dark | Role |
|---|---|---|---|
| **Paper** | `--bg #F7F8FA` / `--card #FFFFFF` | `#101319` / `#171B22` | the ground; cards are Paper-white with a `--line` border |
| **Ink** | `--ink #0F1522` · `--ink2 #5A6472` · `--ink3 #8A93A0` | `#E8EAEE` · `#9AA3AF` · `#6B7480` | text hierarchy: primary / secondary / muted |
| **Ledger Blue** | `--acc #1B5BF0` (+ `--acc-soft`, `--acc-line`) | `#6E96F6` (+ soft/line) | the ONE interactive + brand accent: buttons, links, active nav, focus rings |
| **Verdict Green** | `--good #0E8345` (+ soft) | `#4CC38A` | "worked" — the Scorekeeper's color; semantic only, never decorative |
| **Caution Amber** | `--warn #B25E00` (+ soft) | `#E5A155` | "mixed" / the bold-swing option badge |
| **Miss Red** | `--crit #C6222F` (+ soft/line) | `#F27D7D` | "didn't work" / "fell short" |

- `--chart2 #0E8A6D` (teal) exists as the **second chart voice only** (e.g.
  the Shorts bar beside a full-videos bar). Never for UI chrome.
- Lines: `--line` for borders, `--line2` for row separators and hover fills.
- Elevation shadow: `--shadow` (see §4).
- **Approved defect fix (the only one):** the avatar gradient is currently
  a hardcoded orange pair inside `.ava` — the one non-tokenized color in
  the stylesheet. It becomes two tokens (`--ava-a`, `--ava-b`) with the
  current values; no visual change.

## 3. Type — three roles

| Role | Face | Usage |
|---|---|---|
| **Display** | Newsreader (Google Fonts via next/font, weights 500–600 only) | Page h1, landing hero, report titles. Never in cards, buttons, tables, or nav. The register is the analyst's morning memo — newsroom, not boutique. If it ever reads "artisanal brand" in screenshots, fall back to tightened Inter; the face is replaceable, the restraint rule is not |
| **Body** | Inter (already shipped via next/font) | Everything else. An analyst's prose should disappear |
| **Data/mono** | IBM Plex Mono, falling back to the shipped `--mono` system stack | Numbers, timestamps, before→after pairs, receipt provenance lines, chart axes. Always `font-variant-numeric: tabular-nums` (the existing `.num` class) |

**The type ladder** — new work picks a step; no other `font-size` values:

| Step | Size | Face | Where |
|---|---|---|---|
| data-xs | 10.5px uppercase, letter-spaced | Body (bold) / Mono (axes) | `.k` section labels, chart axes |
| meta | 11.5px | Body / Mono | pills, `.sub` meta lines, bylines |
| body-s | 12.5px | Body | secondary prose, explanations |
| body | 13.5px | Body | primary UI prose, buttons, nav |
| body-l | 15px | Body | leads, `.btn-lg` |
| title | 20px | Display | page h1 (`.pagehead h1`) |
| stat | 27px | Mono | `.stat .big` numbers |
| display-m | clamp(24px, 3.6vw, 34px) | Display | landing section h2 |
| display-xl | clamp(34px, 6vw, 58px) | Display | landing hero h1 |

Existing 12px/13px usages migrate to the nearest step as files are touched;
no sweep.

## 4. Spacing, radius, elevation

- **Spacing ladder:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Card padding 16;
  grid gaps 12 or 16; stacked-section gap 24. Pick a step; never invent a
  value.
- **Radius:** 8 (inputs, buttons, small controls) · 12 (cards, modals) ·
  16 (landing feature cards) · 999 (pills). Existing 7/10/14 values migrate
  as touched.
- **Elevation:** three levels. e0 = border only (`--line`) — the default
  for all app cards; on a light ground, borders beat shadows. e1 =
  `--shadow` — popovers and the landing cards' hover lift. e2 = modal over
  scrim. A shadow never substitutes for a border.

## 5. Motion

**One orchestrated moment: the read arriving.** When an analyst finishes,
the retention curve draws on left-to-right once (SVG stroke-dash, ~600ms,
ease-out), then the result blocks below settle in with a single stagger
(≤400ms total). That is the product's "your analyst just finished reading"
beat and the only choreographed motion in the app.

Everything else: 120ms micro-transitions (hover, focus, pill state) or
nothing. No parallax, no scroll-triggered effects, no looping animation in
the app shell (the landing hero's float is the marketing exception and
already respects reduced motion).

`prefers-reduced-motion: reduce` disables all of it — the existing global
rule extends to the curve draw and the stagger.

## 6. The signature: the Receipt

Everything the team claims arrives pinned to a receipt — verbatim evidence
from the user's own channel, presented as a designed object. One
component, three contents:

1. **A viewer's words** — the verbatim comment, with likes and source.
2. **A before→after pair** — the Scorekeeper's numbers ("41 a day → 128 a
   day"), with when and where they were measured.
3. **A moment in the video** — a timestamp and what was happening ("at
   2:14 — where the drop starts").

Form: Paper-white block, a heavy left rule in the semantic color of what
it proves (Ledger Blue while open, Verdict Green / Caution Amber / Miss
Red once judged), a Plex Mono provenance line on top (source · count ·
date), the verbatim content at body size. Distinct by **structure and
typography, never by a special background hue**. Quote marks are real
characters, not icons. Receipts never paraphrase — verbatim or nothing.

## 7. Verdict chip — four states

The Scorekeeper's stamp. Exactly four states:

| State | Rendering |
|---|---|
| ✓ worked | Verdict Green pill |
| ~ mixed | Caution Amber pill |
| ✕ didn't work | Miss Red pill |
| too early to judge | **neutral muted ink** (`--ink2` on `--line2`) — never a semantic color; honesty about thin data is not a warning state |

Chips stamp receipts and ledger rows. A chip never appears without the
evidence it judges reachable from the same screen.

## 8. Option card

Decisions ship as **2–3 typed choices — never one order** (CLAUDE.md,
locked). The shared option-card molecule:

- Type badge: the safe bet / the smart reach / the bold swing.
- **Effort tag: minimal edit / re-cut / format change.**
- The choice in one bold plain-English sentence, then why, then the
  confidence bar and evidence chips.
- One action: "I'll do this — log it" → the pick lands in the Ledger with
  its before-numbers; the logged state names the Scorekeeper.

This molecule is currently re-implemented inline on four screens; it gets
extracted once into `src/components/` and every screen uses the shared one.

## 9. The evidence line

Every recommendation leads with its revelation, in the same sentence as
the action — what the data shows that the user couldn't see, welded to
what to do about it. Pattern: *"[what your numbers show] — [the move it
points at]."* A tip that arrives without its revelation is a listicle
line; cut it or find the evidence.

## 10. Icon language — one, named

**Plain-stroke**: currentColor SVG outlines, 1.8px stroke, rounded caps,
24px grid — the style already established by `src/components/TeamIcons.tsx`.
That is the app's single icon language. The unicode/emoji glyphs currently
in app chrome (◐ theme toggle, ⚙ settings, ✕ dismiss, ⏳ checking, 🔒
locked nav) migrate to Plain-stroke equivalents as their screens are
touched. Emoji never appear as icons in app chrome; the ✓/~/✕ verdict
glyphs live inside chips as text, which is the one sanctioned use.

## 11. Existing primitives — use them, never re-implement

From `globals.css`: `.btn` (+ `-acc/-ghost/-danger/-lg/-sm`), `.card`,
`.pill` (+ good/warn/crit/acc/mut), `.stat` (+ `.big`, `.delta up/dn/fl`),
`.k`, `.num`, `.grid .g2/.g3`, `.t` data table (+ `.rowed`), `.input` /
`.field` (+ `.code`), `.seg` segmented control, `.modal` + `.modalback`,
`.banner`, `.empty`, `.aside-note`, `.err` / `.ok-note`, `.quiet`, `.sub`,
`.vcell`, the shell (`.shell/.rail/.main/.topbar/.chan/.iconbtn/.pagehead`),
auth (`.authpage/.authcard/.fine/.hr`), settings rows (`.setsect/.setrow`),
`.qrbox`, `.byline`, `.tick`, and the public-site set (`.site-*`, `.hero`,
`.statband`, `.teamgrid`, `.flow`, `.trust`, `.quoteband`, `.ldemo`,
`.eyebrow`, `.prose`).

From `src/components/`: `Md`, `Explain` (+ `WrongClaim`, `Thumb`,
`RatioBar`), `RetentionChart`, `Verdict` (`BeforeAfter`, `ConfidenceBar`,
`EvidenceChips`), `TeamIcons`, `AuthCard`, `Site` (header/footer),
`HeroPreview`, `HowVisuals`.

To be extracted as shared molecules (they exist today only as inline
copies): the option card (§8), the receipt (§6), the stat card, `Byline`
(currently private to one page), and the loading narration (§13).

**Rule:** if a primitive exists, new work uses it. Re-implementing one
inline — or adding an inline style where a token or class exists — is a
review-blocking defect.

## 12. The team: seat naming and the canonical roster

**Naming system.** Seats are named for jobs a human could hold in a
creator's studio — **never for a metric**. No invented human first names.
Every seat debuts with its job line: one first-person, plain-English
sentence of what it does (pattern: *"the Scout — I find the outside video
worth comparing yours to"*).

**The canonical roster** (decided 2026-08-05; user-set):

| Seat | Job line |
|---|---|
| the Editor | "I find the exact second viewers leave — and what you were saying when they did." |
| the Marketer | "I grade your title and thumbnail — and hand you stronger options before you publish." |
| the Listener | "I read every comment so you don't have to — and surface the videos your viewers already asked for." |
| the Scout | "I find the outside video worth comparing yours to — and what's yours to take from it." |
| the Scorekeeper | "I check every tip against your real numbers — and show you the misses too." |
| the Researcher | "I dig into a topic and bring back what people actually want from it." |

The roster is six. The team why-verdict is signed by the team, not a
seventh seat; the weekly report uses plain team attribution.

**Historical name mapping** (for matching stored rows and old UI strings —
see the historical-names rule below):

| Historical (in code + DB today) | Canonical |
|---|---|
| Retention Analyst | the Editor |
| Packaging Analyst | the Marketer |
| Audience Analyst | the Listener |
| The Scout | the Scout |
| The Scorekeeper | the Scorekeeper |
| The Researcher | the Researcher |
| The Team (why-verdicts, weekly reports) | the team (plain attribution) |

**Single source going forward:** `src/lib/team.ts`. Every surface that
shows a seat name or job line imports from it.

**Rename surface (verified — names are currently multi-source):** a seat
rename must touch `src/lib/team.ts`, the shell's TEAM array in
`src/app/(app)/layout.tsx`, the landing TEAM array in `src/app/page.tsx`,
the aria-labels in `src/components/TeamIcons.tsx`, and the `agent` strings
each API route writes to `reports` / `recommendations`.

**Historical content keeps its historical names.** Stored rows (reports,
recommendations) are never rewritten on a rename — only new output uses
the new names. UI that filters by agent name must match old names for old
rows.

## 13. Required designed states — every screen

| State | Requirement |
|---|---|
| **Empty** (brand-new channel) | An invitation to act, never a blank: what the team will do here, and the one button that starts it. The styled `.empty` block is the floor, not the ceiling |
| **Thin data** | Honest "too early to judge" framing in plain words — why the numbers can't be trusted yet and when that changes. Never padding, never a fake verdict |
| **Loading** | Narrates the team at work — *"the Scout is reading both videos…"*, named seat, present tense. Never a bare spinner, never a lone "Loading…" |
| **Error** | Says what happened and what to do next, in one or two sentences. Errors don't apologize and are never vague ("Couldn't reach YouTube — try again in a minute" beats "Something went wrong") |

A screen missing any of these four is unfinished, whatever else it does.

## 14. The anti-checklist — what "basic" looks like

If a screenshot resembles any of this, iterate before showing it:

- Uniform gray-on-white cards with nothing differentiating content types
- One-note default-gray palette; semantic colors used decoratively
- Identical 16px spacing rhythm everywhere (no hierarchy in the gaps)
- Unstyled or missing empty states
- A centered spinner (or bare "Loading…") as the loading experience
- Grids of bold numbers with small labels and no action attached
- Copy that describes features instead of user outcomes
- Emoji used as icons in app chrome
- Any new inline style where a token or class exists
- Horizontal overflow at 390px
- A signed-in screen with no navigation on phones
- Dark-theme regressions (the dark theme exists — check it)

## 15. Quality floor

- Phone-tier surfaces fully usable at 390px, including navigation;
  desktop-tier surfaces readable at 390px with the works-best-on-desktop
  line (§17).
- Visible keyboard focus on every interactive element (the existing
  `:focus-visible` outline is the pattern).
- `prefers-reduced-motion` respected everywhere (§5).
- Both themes hold for any theme-touching change; light is the reference.

## 16. Screenshot protocol (from CLAUDE.md session discipline)

For UI work: run the app, screenshot every changed screen at 1440px and
390px (both themes if the change touches theme-sensitive surfaces), open
and LOOK at them, critique against this file — especially §14 — iterate at
least twice, keep the final screenshots and cite their paths in the session
report.

## 17. Mobile policy

Two tiers, user-set 2026-08-06:

- **Phone tier — first-class at 390px with real navigation:** the check-in
  surfaces — the Desk, why-reads, the Ledger, reports, the idea list,
  research reads, settings.
- **Desktop tier — readable on phones, built for desktop:** the working
  surfaces — packaging (thumbnail work), the Scout comparison desk, and
  future compose-heavy screens. On phones these render stacked and readable
  with one quiet "works best on a bigger screen" line — never a hard gate,
  never a dead end.
- **Classifying rule for future screens:** read or tap → phone tier;
  compose, upload, or side-by-side work → desktop tier.

**The shipped mechanism** (`globals.css`, phone-tier block; the shell in
`src/app/(app)/layout.tsx`). Below 860px — the same breakpoint at which
`.g2`/`.g3` collapse to one column, so stacking and the shell switch
together:

- The rail becomes a slide-over panel, opened by **All screens** in the
  bottom bar and closed by the scrim, Escape, or arriving somewhere. It is
  the same grouped nav as on desktop — no phone-only route list to keep in
  sync.
- The cycle condenses into a fixed bottom bar (Today · 1 Why · 2 Next ·
  3 Score · All screens), so which step you're in is visible under your
  thumb; the topbar keeps the active step's one-line worth (`.cycnow`).
- Desktop-tier routes are named once in the shell's `DESKTOP_TIER` array,
  which renders the quiet note above the page. Adding a screen to that tier
  is a one-line change and touches no page file.
