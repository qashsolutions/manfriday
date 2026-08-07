/** The Editor's brief for the Hook Doctor: the system prompt, the shape of the
    answer, and the material the read is built from.

    The one rule that separates this surface from the distribution read: below
    the floor the Editor still writes. Thin numbers change what the openings are
    grounded in and what they are called — never whether the creator gets help.
    What is forbidden is faking the grounding. */

import { OPTIONS_RULES } from "./claude";
import { MIN_VIEWS_FOR_CURVE } from "./hookData";
import { OPENING_SECONDS } from "@/lib/hook";
import type { HookGrounding } from "./hookData";
import { allExits, bestHeld } from "./hookData";

export const SYSTEM = `You are the Editor at manfriday: you find the exact second viewers leave, and what the
creator was saying when they did. Here you do one thing — the opening. Most of the viewers a video
loses are gone in the first ${OPENING_SECONDS} seconds, so the opening is the cheapest edit a creator
can make and the one with the largest effect on how long people stay, which is what decides how widely
YouTube shows it.

Hard limits:
- Openings only. Each option is at most about ${OPENING_SECONDS} seconds of speech — roughly 75 words.
  Never write past that, and never write the rest of the video. If the creator seems to be asking for a
  whole script, give them the opening anyway and say plainly in in_short that the rest is theirs.
- Never invent a second, a share of viewers, a view count, or a pattern. You may only name exit seconds
  and hold numbers that appear in the material below, and you must quote them as they are given.
- Where the material says you have no usable exit seconds, where_they_left MUST be null and no option
  may state or imply where this creator's viewers left. Write on craft and say so.
- Match the register of the words you were given. Where you were given no sample of how this creator
  actually speaks, say so plainly in voice_note, match whatever draft you were given, and never claim
  to be imitating their voice or invent a persona for them.
- Where the schema asks for rewrites, the count is 2 or 3 — one per shape. That overrides the "exactly
  three" in the shared option rules below: two honest openings beat three with one padded.
- Every option's "why" carries its evidence in the same sentence as the move. A rewrite that arrives
  without the reason it exists is a writing tip; the evidence is the whole product.
- Keep every field short enough to read on a phone.

${OPTIONS_RULES}`;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["in_short", "where_they_left", "voice_note", "rewrites"],
  properties: {
    in_short: {
      type: "string",
      description:
        "The read, opening with '**In short** — ' and then 2-3 plain-English sentences: what the openings " +
        "below are built on, and what the creator should expect from changing theirs. When the material " +
        "says there are no usable exit seconds, say so here in plain words — that these are built on craft " +
        "rather than on their own numbers, and what changes once one of their videos passes about " +
        `${MIN_VIEWS_FOR_CURVE} viewers.`,
    },
    where_they_left: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "One or two sentences naming the exact seconds viewers left their recent videos, copied from the " +
        "material, welded to what that means for the opening. MUST be null when the material says there " +
        "are no usable exit seconds — inventing one here is the single worst thing this read can do.",
    },
    voice_note: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "One plain sentence, ONLY when you were given no sample of how this creator actually speaks: say " +
        "that these are written to match the words they gave you rather than their speaking voice, and " +
        "that pasting how one of their videos opens makes the next set sound like them. Null when a " +
        "sample was given.",
    },
    rewrites: {
      type: "array",
      description:
        "2 or 3 openings the creator picks between — one per shape, in the order cold open, question, " +
        "result-first. Never two of the same shape, and never a third for the sake of three.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["shape", "effort", "choice", "opening", "why", "confidence", "evidence"],
        properties: {
          shape: {
            type: "string",
            enum: ["cold open", "question", "result-first"],
            description: "Which of the three shapes this opening takes, exactly as named in the material.",
          },
          effort: {
            type: "string",
            enum: ["minimal edit", "re-cut", "format change", "next upload", "new video"],
            description:
              "What this honestly costs them. Re-recording the first thirty seconds of a video that is " +
              "already up is a 're-cut'; changing the words of a draft they haven't filmed is a 'minimal " +
              "edit'. Only use 'next upload' or 'new video' when the change genuinely can't be made to " +
              "what they already have.",
          },
          choice: {
            type: "string",
            description:
              "The shape in one plain sentence, starting with its name — e.g. 'Cold open — start on the " +
              "finished shelf, no greeting.' This is the choice they are making; the words below are how " +
              "it sounds.",
          },
          opening: {
            type: "string",
            description:
              `The actual words to say, at most about ${OPENING_SECONDS} seconds spoken — roughly 75 ` +
              "words, never more. Spoken English in their register, ready to read off the screen. No " +
              "stage directions, no notes to the creator, no square brackets.",
          },
          why: {
            type: "string",
            description:
              "The revelation and the move in ONE sentence — what their own numbers show welded to what " +
              "this opening does about it (e.g. 'viewers left at 0:22 last time, right as the intro ran " +
              "long — this one is at the result before then'). Where there are no exit seconds, say what " +
              "this shape is for and be plain that it isn't grounded in their numbers yet.",
          },
          confidence: { type: "integer", description: "0-100, derived per the confidence rules from citable evidence only." },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "label"],
              properties: {
                kind: { type: "string", enum: ["ledger", "library", "search", "audience", "caution"] },
                label: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** The three shapes, defined once so the model and the creator mean the same
    thing by them. */
const SHAPES = `THE THREE SHAPES — one option each, 2 or 3 in total
- "cold open": start inside the thing itself — the finished result, the moment it went wrong, the
  sentence that only makes sense if you keep watching. No greeting, no channel name, no throat-clearing.
- "question": open on the exact question this video answers, in the words a viewer would actually use.
- "result-first": state or show the outcome first, then promise the path to it.`;

export type HookMaterialArgs = {
  audienceBlock: string;
  trackBlock: string;
  grounding: HookGrounding;
  /** Which way in the creator came: a draft they wrote, or a video to re-hook. */
  mode: "draft" | "video";
  draft: string | null;
  /** The one optional paste. In video mode it is what that video actually says
      at the start; in draft mode it is how a past opening of theirs went. */
  spoken: string | null;
  /** In draft mode, which video the sample came from. */
  spokenFrom: string | null;
  video: { title: string; views: number | null; durationSeconds: number | null; isShort: boolean } | null;
  channel: { title: string | null; subscriberCount: number | null };
};

export function hookMaterial(a: HookMaterialArgs): string {
  const exits = allExits(a.grounding);
  const held = bestHeld(a.grounding);

  const job =
    a.mode === "video"
      ? `THE JOB: write this creator a stronger opening for a video that is already up. They can re-record
the first ${OPENING_SECONDS} seconds and re-upload, or use it on the next one — say which you mean.`
      : `THE JOB: the creator has written the opening below and wants it stronger before they film it.`;

  const working =
    a.mode === "video" && a.video
      ? `THE VIDEO THEY'RE RE-HOOKING
Title: ${a.video.title}
Format: ${a.video.isShort ? "Short" : "Full video"}
Views so far: ${a.video.views ?? "unknown"}`
      : `THEIR DRAFT OPENING (their own words — this is what you are rewriting)
${a.draft ?? "(none given)"}`;

  const groundingBlock = a.grounding.grounded
    ? `WHERE VIEWERS LEFT IN THE FIRST MINUTE OF THEIR OWN VIDEOS (real seconds from their real numbers —
you may name these and only these)
${a.grounding.videos
  .filter((v) => v.exits.length)
  .map(
    (v) =>
      `- "${v.title}" (${v.views} views): ` +
      v.exits
        .map(
          (e) =>
            `${e.lostPer100} of every 100 who got that far left at ${e.label}, ` +
            `leaving ${e.stillPer100} of every 100 still watching`
        )
        .join("; ")
  )
  .join("\n")}
${
  held.length
    ? `\nWHICH OF THEIR OPENINGS HELD BEST (share still watching half a minute in — the ones worth copying)
${held.map((h) => `- "${h.videoTitle}": ${h.heldPer100} of every 100 still watching at ${h.label}`).join("\n")}`
    : ""
}`
    : `NO USABLE EXIT SECONDS — WRITE ON CRAFT, AND SAY SO
None of their recent videos has enough viewers yet for the team to trust where people left: the floor is
about ${MIN_VIEWS_FOR_CURVE} viewers on a video, and below that a "drop" is a handful of people rather
than a pattern.${a.grounding.belowFloor ? ` ${a.grounding.belowFloor} of their recent videos sit under it.` : ""}
So: write these openings on craft alone. Do NOT state or imply any second, any share of viewers, or any
pattern from their own videos — you have none. where_they_left MUST be null, and in_short must say
plainly that these are built on craft rather than on their numbers, and what changes once one of their
videos passes that mark.`;

  const voiceBlock =
    a.spoken && a.mode === "video"
      ? `WHAT THIS VIDEO ACTUALLY SAYS AT THE START (pasted by the creator — their real speech, and the words
viewers heard on their way to the seconds above). Use it twice: quote it when you explain an exit, and
match its rhythm and vocabulary when you write. This is how they talk.
${a.spoken}`
      : a.spoken
        ? `HOW THEY OPENED${a.spokenFrom ? ` "${a.spokenFrom}"` : " one of their videos"} (pasted by the creator — the
opening that held viewers best). This is how they talk: match its rhythm and vocabulary. Never quote it
as though it were in the new video.
${a.spoken}`
        : a.draft
          ? `NO SAMPLE OF HOW THEY ACTUALLY SPEAK. The draft above is the only writing of theirs you have.
Match the draft's register, never invent a persona for them, and
never claim to be imitating their voice — say so plainly in voice_note.`
          : `NO SAMPLE OF HOW THEY ACTUALLY SPEAK, AND NO DRAFT. All you have of theirs is the title.
Write in plain spoken English, never invent a persona for them, and
never claim to be imitating their voice — say so plainly in voice_note.`;

  return `
${a.audienceBlock}

${a.trackBlock}

${job}

THEIR CHANNEL
${a.channel.title ?? "their channel"} — ${a.channel.subscriberCount ?? "?"} subscribers

${working}

${groundingBlock}

${voiceBlock}

${SHAPES}

WHAT THE OPENING HAS TO DO
Viewers who stay past the first ${OPENING_SECONDS} seconds are what YouTube reads as a video worth
showing to more people. So every option earns its place by keeping someone there — not by sounding
clever, and not by explaining what the video will cover.
${exits.length ? `The seconds above are where this creator loses them; write past those moments specifically.` : ""}
`.trim();
}
