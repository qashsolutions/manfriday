/** The four answers "How viewers found it — and why that changed" can give,
    rendered. A live signed-in account shows whichever one its own channel
    happens to be in — usually the honest thin one — so the other three can
    only be proved here (DESIGN.md §13).

    The rule under test is the one this screen exists to keep: a fall in
    YouTube's feed and a video that stopped working look identical on a views
    graph and are opposites. The words have to separate them, and nothing may
    be coloured as a failure that isn't one. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DistributionSection,
  type DistributionRead,
  type DistributionOption,
} from "@/app/(app)/why/[id]/DistributionSection";
import { pickTeamReports, whyActions } from "@/app/(app)/why/[id]/page";

const noop = () => {};

function html(read: DistributionRead | null, logged = new Set<string>()): string {
  return renderToStaticMarkup(
    <DistributionSection
      read={read}
      asking={false}
      stages={[]}
      prose=""
      error={null}
      logged={logged}
      onAsk={noop}
      onLog={noop}
    />
  );
}

function text(read: DistributionRead | null, logged = new Set<string>()): string {
  return html(read, logged)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const BANNED = /\b(median|baseline|ratio|quartile|delta|metric|KPI|dashboard|optimi[sz]e|insight|leverage|AI-powered|CTR|impressions|artifact|anomaly|traffic source)\b/i;
const RAW_YT = /\b(YT_SEARCH|RELATED_VIDEO|SUBSCRIBER|EXT_URL|NO_LINK_OTHER|insightTrafficSource)\b/;

const FOUND = [
  { label: "YouTube suggested it beside another video", views: 900, share: 0.66 },
  { label: "people searched YouTube and found it", views: 120, share: 0.09 },
  { label: "a link shared off YouTube", views: 40, share: 0.03 },
];

const WINDOWS = {
  recentFrom: "2026-07-30", recentTo: "2026-08-05",
  priorFrom: "2026-07-23", priorTo: "2026-07-29",
};

const OPTION: DistributionOption = {
  type: "safe",
  effort: "minimal edit",
  text: "Retitle this video around the question your commenters keep asking.",
  category: "packaging",
  why: "Nobody found it by searching — every view came from a feed you don't control, so a searchable title adds a way in that can't be switched off.",
  confidence: 45,
  evidence: [{ kind: "search", label: "people type this" }],
};

/** YouTube's feed collapsed; the people who already follow the channel held. */
const MOSTLY_DISTRIBUTION: DistributionRead = {
  state: "distribution",
  reason: null,
  reasonKind: null,
  found: FOUND,
  foundTotal: 1060,
  change: [
    { key: "feed", label: "YouTube putting it in front of people", recent: 32, prior: 185 },
    { key: "followers", label: "people who already follow you", recent: 38, prior: 40 },
  ],
  windows: WINDOWS,
  checkBy: "2026-08-21",
  analysis: {
    state: "distribution",
    verdict: "**In short** — views from YouTube's suggestions fell from 185 to 32 while the people who already follow you held at 38, so the video didn't get worse — YouTube stopped putting it in front of strangers.",
    where_from: "Almost every view arrived through YouTube suggesting it beside another video.",
    what_changed: "Last week YouTube's suggestions sent 32 views, against 185 the week before.",
    control_test: "The people who already follow you held at 38 while YouTube's own feed fell from 185 to 32 — that's the distribution moving, not your video.",
    steady_note: "When YouTube widens a video to people who don't know you, the average time watched falls — that fall is what widening looks like, not the video getting worse.",
    options: [OPTION],
  },
  createdAt: "2026-08-07T09:00:00Z",
};

/** Both ways in fell together — the lever is the video. */
const MOSTLY_YOU: DistributionRead = {
  ...MOSTLY_DISTRIBUTION,
  state: "you",
  change: [
    { key: "feed", label: "YouTube putting it in front of people", recent: 30, prior: 190 },
    { key: "followers", label: "people who already follow you", recent: 9, prior: 44 },
  ],
  analysis: {
    ...MOSTLY_DISTRIBUTION.analysis!,
    state: "you",
    verdict: "**In short** — both ways in fell together: YouTube's suggestions went 190 to 30 and the people who already follow you went 44 to 9, and when your own followers stop showing up too, the video is the thing to change.",
    control_test: "The people who already follow you fell from 44 to 9 alongside the feed's 190 to 30 — when the people who chose you drop off, that's the video.",
    steady_note: null,
  },
};

/** Nothing moved. Saying so is the service. */
const STEADY: DistributionRead = {
  ...MOSTLY_DISTRIBUTION,
  state: "steady",
  change: [
    { key: "feed", label: "YouTube putting it in front of people", recent: 170, prior: 178 },
    { key: "followers", label: "people who already follow you", recent: 41, prior: 40 },
  ],
  analysis: {
    ...MOSTLY_DISTRIBUTION.analysis!,
    state: "steady",
    verdict: "**In short** — nothing moved: YouTube sent 170 views last week against 178 the week before, and your own followers held at about 40, so there's no drop here to explain.",
    control_test: null,
    steady_note: null,
  },
};

const TOO_NEW: DistributionRead = {
  state: "too_early",
  reasonKind: "too_new",
  reason: "YouTube's numbers on a video keep moving for a week or two after it goes up. This one is 3 days old, so anything called a drop today would be the numbers still settling — not something you did. From day 15 there are two full weeks to compare.",
  found: FOUND,
  foundTotal: 1060,
  change: null,
  windows: WINDOWS,
  checkBy: null,
  analysis: null,
  createdAt: null,
};

const TOO_QUIET: DistributionRead = {
  ...TOO_NEW,
  reasonKind: "too_quiet",
  reason: "Across the two weeks the team compares, this video got 11 views in total — too few to tell a real change from ordinary week-to-week wobble. Where your views came from is below and it is real; what changed is not something the team will guess at.",
  found: [{ label: "a link shared off YouTube", views: 15, share: 1 }],
  foundTotal: 15,
};

describe("mostly how YouTube spread it", () => {
  it("names the cause and puts the receipt in the same breath", () => {
    const t = text(MOSTLY_DISTRIBUTION);
    expect(t).toContain("mostly how YouTube spread it");
    expect(t).toContain("fell from 185 to 32 while the people who already follow you held at 38");
    // the control test arrives as a receipt, provenance and all (DESIGN.md §6)
    expect(t).toContain("your channel · Jul 30–Aug 5 against Jul 23–29");
    expect(t).toContain("that's the distribution moving, not your video");
  });

  it("shows the two ways in as they moved, in words a creator uses", () => {
    const t = text(MOSTLY_DISTRIBUTION);
    expect(t).toContain("YouTube putting it in front of people");
    expect(t).toContain("people who already follow you");
    expect(t).toContain("down");        // the feed
    expect(t).toContain("held steady"); // the control
    expect(t).toContain("week before");
    expect(t).toContain("last week");
  });

  it("never colours a widening video as a failure", () => {
    const markup = html(MOSTLY_DISTRIBUTION);
    // Miss Red is the Scorekeeper's "didn't work" — a fall in the feed is not
    // that verdict, and this screen exists to say so.
    expect(markup).not.toContain("var(--crit)");
    expect(markup).not.toContain("pill crit");
  });

  it("carries the panic defuser when it applies", () => {
    expect(text(MOSTLY_DISTRIBUTION)).toContain("Before you panic");
    expect(text(MOSTLY_DISTRIBUTION)).toContain("that fall is what widening looks like");
  });

  it("offers the response as a typed choice with its cost and its check-back day", () => {
    const t = text(MOSTLY_DISTRIBUTION);
    expect(t).toContain("The safe bet");
    expect(t).toContain("minimal edit");
    expect(t).toContain(OPTION.text);
    expect(t).toContain("I'll do this — log it");
    expect(t).toContain("check back on Aug 21");
    expect(t).toContain("that's when YouTube's numbers on a change like this have settled");
  });

  it("shows a pick already taken as taken, naming who checks it", () => {
    const t = text(MOSTLY_DISTRIBUTION, new Set([OPTION.text]));
    expect(t).toContain("in your Ledger — the Scorekeeper will check it");
    expect(t).not.toContain("I'll do this — log it");
  });
});

describe("mostly your video", () => {
  it("says the lever is the video, with both numbers", () => {
    const t = text(MOSTLY_YOU);
    expect(t).toContain("mostly your video");
    expect(t).toContain("when the people who chose you drop off, that's the video");
    expect(t).toContain("when your own followers stop showing up too, the video is the thing to change");
  });
});

describe("nothing moved", () => {
  it("says so plainly instead of manufacturing a drop", () => {
    const t = text(STEADY);
    expect(t).toContain("nothing moved");
    expect(t).toContain("there's no drop here to explain");
    expect(t).toContain("held steady");
  });
});

describe("too early to judge", () => {
  it("says why the numbers can't be read yet, and when they can", () => {
    const t = text(TOO_NEW);
    expect(t).toContain("too early to judge");
    expect(t).toContain("3 days old");
    expect(t).toContain("From day 15");
    expect(t).not.toContain("mostly");
  });

  it("is a thin state, never a warning state", () => {
    // DESIGN.md §7: honesty about thin data wears neutral muted ink
    expect(html(TOO_NEW)).toContain("pill mut");
    expect(html(TOO_NEW)).not.toContain("pill warn");
    expect(html(TOO_NEW)).not.toContain("pill crit");
  });

  it("still shows what IS known — the thin state is not a blank one", () => {
    const t = text(TOO_NEW);
    expect(t).toContain("Where the views came from");
    expect(t).toContain("YouTube suggested it beside another video");
    expect(t).toContain("900 of 1,060");
    // and welds it to the reason a creator should care
    expect(t).toContain("the further a video travels past the people you told about it yourself");
  });

  it("offers nothing to log and invents no comparison", () => {
    const t = text(TOO_NEW);
    expect(t).not.toContain("I'll do this — log it");
    expect(t).not.toContain("What changed");
    expect(t).not.toContain("check back on");
  });

  it("says two quiet weeks are quiet, not that the video failed", () => {
    const t = text(TOO_QUIET);
    expect(t).toContain("11 views in total");
    expect(t).toContain("week-to-week wobble");
    expect(t).toContain("a link shared off YouTube");
  });
});

describe("before the read is asked for", () => {
  it("states what the question is worth, and offers the one button that answers it", () => {
    const t = text(null);
    expect(t).toContain("How viewers found it — and why that changed");
    expect(t).toContain("whether the video stopped working or YouTube stopped showing it around");
    expect(t).toContain("Was it my video or the algorithm? — ask the team");
  });
});

/** The other two guarantees this screen carries, at the seams the JSX switches
    on — the same way the failed-read guard is proved (tests/reads/unreachable). */
describe("/why/[id] — the team's two reads share one signature", () => {
  const whyRow = {
    id: "w1", created_at: "2026-08-01T00:00:00Z",
    data: { verdict: "…", reasons: [{ reason: "…", evidence: "…", agent: "the Scout" }], devils_advocate: "…", actions: [] },
  };
  const distRow = {
    id: "d1", created_at: "2026-08-07T00:00:00Z",
    data: { kind: "distribution", state: "distribution", verdict: "…", options: [] },
  };

  it("gives each read its own row, whichever was asked most recently", () => {
    // newest first, as the query orders them: the distribution read used to
    // shadow the why-verdict entirely, because only the newest row was taken
    expect(pickTeamReports([distRow, whyRow])).toEqual({ why: whyRow, distribution: distRow });
    expect(pickTeamReports([whyRow, distRow])).toEqual({ why: whyRow, distribution: distRow });
  });

  it("finds nothing where there is nothing, rather than the wrong thing", () => {
    expect(pickTeamReports([])).toEqual({ why: null, distribution: null });
    expect(pickTeamReports([distRow])).toEqual({ why: null, distribution: distRow });
    expect(pickTeamReports([whyRow])).toEqual({ why: whyRow, distribution: null });
    expect(pickTeamReports([{ id: "x", created_at: "…", data: null }])).toEqual({ why: null, distribution: null });
  });
});

describe("verdicts written before typed options", () => {
  const ACTION = { text: "Retitle it.", category: "packaging", why: "…", confidence: 40, evidence: [] };

  it("still render — stored rows are never rewritten (DESIGN.md §12)", () => {
    const old = { verdict: "…", reasons: [], devils_advocate: "…", action: ACTION };
    expect(whyActions(old)).toEqual([ACTION]);
  });

  it("give way to the typed options once a row has them", () => {
    const fresh = {
      verdict: "…", reasons: [], devils_advocate: "…",
      actions: [{ ...ACTION, type: "safe" as const, effort: "minimal edit" }, { ...ACTION, type: "reach" as const, effort: "next upload" }],
    };
    expect(whyActions(fresh)).toHaveLength(2);
    expect(whyActions({ ...fresh, action: ACTION })).toHaveLength(2);
  });

  it("never hand the screen an undefined to render", () => {
    expect(whyActions({ verdict: "…", reasons: [], devils_advocate: "…" })).toEqual([]);
    expect(whyActions({ verdict: "…", reasons: [], devils_advocate: "…", actions: [] })).toEqual([]);
  });
});

describe("every state, every word", () => {
  const all: [string, DistributionRead | null][] = [
    ["mostly the distribution", MOSTLY_DISTRIBUTION],
    ["mostly you", MOSTLY_YOU],
    ["steady", STEADY],
    ["too new", TOO_NEW],
    ["too quiet", TOO_QUIET],
    ["not yet asked", null],
  ];

  for (const [name, read] of all) {
    it(`${name}: no banned word reaches the reader`, () => {
      expect(text(read)).not.toMatch(BANNED);
    });
    it(`${name}: no raw YouTube source name reaches the reader`, () => {
      expect(text(read)).not.toMatch(RAW_YT);
    });
  }
});
