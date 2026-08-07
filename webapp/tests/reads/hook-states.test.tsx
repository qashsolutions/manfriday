/** The Hook Doctor's states, rendered. A signed-in production account shows
    whichever one its own channel happens to be in — on a channel with a
    handful of views that is always the craft-based one — so the grounded state
    can only be proved here (DESIGN.md §13).

    The rule under test is the one this surface exists to keep: openings are
    written either way, but a read that isn't grounded in the creator's own
    numbers must never look like one that is. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HookCompose, HookRewrites } from "@/app/(app)/hook/HookDesk";
import { CRAFT_LABEL, GHOSTWRITE_LINE, type HookRead, type HookRewrite } from "@/lib/hook";

const noop = () => {};

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function strip(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const BANNED = /\b(median|baseline|ratio|quartile|delta|metric|KPI|dashboard|optimi[sz]e|insight|leverage|AI-powered|CTR|impressions|artifact|anomaly|traffic source|retention)\b/i;

const REWRITES: HookRewrite[] = [
  {
    shape: "cold open",
    effort: "minimal edit",
    choice: "Cold open — start on the finished shelf, no greeting.",
    opening: "This shelf holds two hundred kilos and cost me forty quid. Here's the join that does it.",
    why: "29 of every 100 left at 0:22 last time, right as the intro ran long — this one is inside the build before that second arrives.",
    confidence: 45,
    evidence: [{ kind: "library", label: "your own drop at 0:22" }],
  },
  {
    shape: "question",
    effort: "re-cut",
    choice: "Question — open on what they came to find out.",
    opening: "Why does every cheap shelf sag in the middle? It's one cut, and you can fix it in ten minutes.",
    why: "12 of every 100 were gone by 0:07 before you'd asked them anything — this names their problem in the first breath.",
    confidence: 40,
    evidence: [{ kind: "library", label: "gone by 0:07" }],
  },
  {
    shape: "result-first",
    effort: "next upload",
    choice: "Result first — show the load test, then the build.",
    opening: "Two hundred kilos on a shelf made of scrap. It held. Here's how it went together.",
    why: "The one opening that held 61 of every 100 to 0:30 was the one that showed the finished thing first — this does the same.",
    confidence: 50,
    evidence: [{ kind: "library", label: "held 61 to 0:30" }],
  },
];

const GROUNDED: HookRead = {
  grounded: true,
  exits: [
    { videoTitle: "My workshop video", label: "0:07", atSeconds: 7, lostPer100: 12, stillPer100: 88 },
    { videoTitle: "My workshop video", label: "0:22", atSeconds: 22, lostPer100: 29, stillPer100: 55 },
  ],
  held: [{ videoTitle: "The shelf build", label: "0:30", heldPer100: 61 }],
  videosRead: 2,
  viewsFloor: 50,
  target: null,
  draft: "Hey guys, welcome back to the channel…",
  checkBy: "2026-08-21",
  analysis: {
    in_short:
      "**In short** — 29 of every 100 viewers who got that far left at 0:22 on your last video, right as " +
      "the intro ran long, so all three openings below are at the point before that second arrives.",
    where_they_left:
      "Your viewers go in two waves: 12 of every 100 are gone by 0:07, and another 29 leave at 0:22 — both " +
      "before the video has shown them anything.",
    voice_note: null,
    rewrites: REWRITES,
  },
  createdAt: "2026-08-07T09:00:00Z",
};

const CRAFT: HookRead = {
  grounded: false,
  exits: [],
  held: [],
  videosRead: 0,
  viewsFloor: 50,
  target: null,
  draft: "Hey guys, welcome back to the channel…",
  checkBy: "2026-08-21",
  analysis: {
    in_short:
      "**In short** — none of your videos has enough viewers yet for YouTube to show where people left, so " +
      "these openings are built on craft rather than on your numbers.",
    where_they_left: null,
    voice_note: "These match the words you pasted rather than your speaking voice — paste how one of your videos opens and the next set will sound like you.",
    rewrites: REWRITES.slice(0, 2),
  },
  createdAt: null,
};

function readMarkup(read: HookRead | null, logged = new Set<string>()): string {
  return render(
    <HookRewrites
      read={read}
      asking={false}
      stages={[]}
      prose=""
      error={null}
      logged={logged}
      copied={null}
      onCopy={noop}
      onLog={noop}
      onAskAgain={noop}
    />
  );
}

function composeMarkup(over: Partial<Parameters<typeof HookCompose>[0]> = {}): string {
  return render(
    <HookCompose
      mode="draft"
      onMode={noop}
      draft=""
      onDraft={noop}
      spoken=""
      onSpoken={noop}
      videos={[{ yt_video_id: "vidAAAAAAA1", title: "My workshop video" }]}
      video=""
      onVideo={noop}
      bestHeldTitle={null}
      asking={false}
      error={null}
      onAsk={noop}
      {...over}
    />
  );
}

describe("grounded in their own seconds", () => {
  it("names the exact seconds viewers left, welded to the video they left", () => {
    const t = strip(readMarkup(GROUNDED));
    expect(t).toContain("built on the seconds your viewers left 2 videos");
    expect(t).toContain("0:22");
    expect(t).toContain("29 of every 100 who got that far left here");
    expect(t).toContain("55 of every 100 were still watching after it");
    expect(t).toContain("My workshop video");
    // the seconds are welded to what to do about them, never a naked number
    expect(t).toContain("the seconds a new opening has to get past");
  });

  it("pins the read to a receipt, provenance and all", () => {
    const t = strip(readMarkup(GROUNDED));
    expect(t).toContain("your channel · 2 videos read");
    expect(t).toContain("Your viewers go in two waves");
  });

  it("names the opening that held, and what makes it worth copying", () => {
    const t = strip(readMarkup(GROUNDED));
    expect(t).toContain("Your opening that held best — the one worth copying");
    expect(t).toContain("61 of every 100 were still watching at 0:30");
    expect(t).toContain("worth doing again");
  });

  it("carries each option's evidence in the same sentence as the move", () => {
    const t = strip(readMarkup(GROUNDED));
    expect(t).toContain("29 of every 100 left at 0:22 last time, right as the intro ran long — this one is inside the build");
    expect(t).toContain("12 of every 100 were gone by 0:07 before you'd asked them anything — this names their problem");
  });

  it("offers the three shapes as choices, each with what it costs", () => {
    const t = strip(readMarkup(GROUNDED));
    expect(t).toContain("Cold open — start on the finished shelf");
    expect(t).toContain("Question — open on what they came to find out");
    expect(t).toContain("Result first — show the load test");
    expect(t).toContain("minimal edit");
    expect(t).toContain("re-cut");
    expect(t).toContain("next upload");
    expect(t).toContain("Three openings — you pick the one you'll actually say");
  });

  it("hands over the words themselves, with the promise of a verdict", () => {
    const t = strip(readMarkup(GROUNDED));
    expect(t).toContain("This shelf holds two hundred kilos and cost me forty quid.");
    expect(t).toContain("Copy");
    expect(t).toContain("I'll say this — log it");
    expect(t).toContain("verdict by Aug 21");
    expect(t).toContain("enough new viewers have seen it for the change to show");
  });

  it("shows a pick already taken as taken, naming who settles it", () => {
    const t = strip(readMarkup(GROUNDED, new Set([REWRITES[0].choice])));
    expect(t).toContain("in your Ledger — the Scorekeeper will check it");
    // the other two are still on the table
    expect(t).toContain("I'll say this — log it");
  });
});

describe("craft-based — below the floor", () => {
  it("says exactly what it is, in the words the product promised", () => {
    const t = strip(readMarkup(CRAFT));
    expect(t).toContain(CRAFT_LABEL);
    expect(t).toContain("craft-based — not yet grounded in your numbers (too few viewers so far)");
  });

  it("is a thin state, never a warning state", () => {
    // DESIGN.md §7: honesty about thin data wears neutral muted ink
    const markup = readMarkup(CRAFT);
    expect(markup).toContain("pill mut");
    expect(markup).not.toContain("pill warn");
    expect(markup).not.toContain("pill crit");
  });

  it("still writes the creator their openings — the floor changes the grounding, not the help", () => {
    const t = strip(readMarkup(CRAFT));
    expect(t).toContain("Two openings — you pick the one you'll actually say");
    expect(t).toContain("Cold open — start on the finished shelf");
    expect(t).toContain("I'll say this — log it");
  });

  it("says what changes once more people watch, and when", () => {
    const t = strip(readMarkup(CRAFT));
    expect(t).toContain("What changes once more people watch");
    expect(t).toContain("about 50 viewers");
    expect(t).toContain("rewrites your opening around the exact second viewers leave");
  });

  it("invents no second, no share, and no video of theirs", () => {
    const t = strip(readMarkup(CRAFT));
    expect(t).not.toContain("Where viewers left your first minute");
    expect(t).not.toContain("held best");
    expect(t).not.toMatch(/\d+ of every 100 who got that far/);
    expect(t).not.toContain("your channel ·"); // no receipt with nothing behind it
  });

  it("is honest about the voice too", () => {
    expect(strip(readMarkup(CRAFT))).toContain("match the words you pasted rather than your speaking voice");
  });
});

describe("the desk before anything is asked", () => {
  it("says what the first 30 seconds are worth, and offers the one button", () => {
    const t = strip(composeMarkup());
    expect(t).toContain("Your first 30 seconds");
    expect(t).toContain("Most of the viewers a video loses are gone before the half-minute mark");
    expect(t).toContain("which is what decides how widely YouTube shows the video");
    expect(t).toContain("Write me openings");
    // both ways in
    expect(t).toContain("Paste a draft");
    expect(t).toContain("Re-hook a video");
  });

  it("counts the words against what they buy, not against a rule", () => {
    const t = strip(composeMarkup({ draft: "one two three" }));
    expect(t).toContain("3 of about 120 words");
    expect(t).toContain("roughly the 30 seconds where viewers decide whether to stay");
  });

  it("answers a whole-script ask with one honest line, and won't send it", () => {
    const markup = composeMarkup({ draft: "word ".repeat(200) });
    expect(strip(markup)).toContain(GHOSTWRITE_LINE);
    expect(strip(markup)).toContain("the rest of the script stays yours to write");
    expect(markup).toContain("disabled");
  });

  it("asks for the video's real first lines when a video is being re-hooked", () => {
    const t = strip(composeMarkup({ mode: "video" }));
    expect(t).toContain("How does this video open? (paste the first lines — YouTube's transcript panel has them)");
    expect(t).toContain("what viewers heard just before they left");
    expect(t).toContain("Pick one of your videos…");
    expect(t).toContain("My workshop video");
  });

  it("only names the best-held opening once a read has found one", () => {
    expect(strip(composeMarkup())).toContain("paste how one of your videos opens");
    expect(strip(composeMarkup({ bestHeldTitle: "The shelf build" })))
      .toContain('paste how you opened "The shelf build", the one that kept the most viewers');
  });
});

describe("while the Editor is working", () => {
  it("narrates the step that is actually running, and hands over the words as they land", () => {
    const t = strip(render(
      <HookRewrites
        read={null}
        asking
        stages={["The Editor is pulling up where viewers left your last few videos…", "The Editor is writing your openings…"]}
        prose="**In short** — 29 of every 100 left at 0:22…"
        error={null}
        logged={new Set()}
        copied={null}
        onCopy={noop}
        onLog={noop}
        onAskAgain={noop}
      />
    ));
    expect(t).toContain("The Editor is pulling up where viewers left your last few videos…");
    expect(t).toContain("The Editor is writing your openings…");
    expect(t).toContain("In short");
  });
});

describe("every state, every word", () => {
  const all: [string, string][] = [
    ["grounded", strip(readMarkup(GROUNDED))],
    ["craft-based", strip(readMarkup(CRAFT))],
    ["the desk", strip(composeMarkup())],
    ["the desk, re-hooking", strip(composeMarkup({ mode: "video" }))],
    ["the desk, over the limit", strip(composeMarkup({ draft: "word ".repeat(200) }))],
  ];

  for (const [name, text] of all) {
    it(`${name}: no banned word reaches the reader`, () => {
      expect(text).not.toMatch(BANNED);
    });
  }
});
