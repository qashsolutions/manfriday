import { describe, expect, it } from "vitest";
import {
  appliedDay, chipFor, copyTextFor, effortFor, isTheAdviceWorking, revelationFor,
  studioUrlFor, whatJustHappened, whatToDoNext, type DeskReport, type Rec,
} from "@/app/(app)/desk/deskModel";
import type { ChannelData, VideoPerf } from "@/lib/channelData";

const NOW = Date.parse("2026-08-07T09:00:00Z");

function video(over: Partial<VideoPerf> = {}): VideoPerf {
  return {
    id: "v-uuid",
    yt_video_id: "yt123",
    title: "Sharpening a chisel, start to finish",
    published_at: "2026-08-05T10:00:00Z",
    is_short: false,
    thumbnail_url: null,
    view_count: 120,
    views_per_day: 40,
    ratio: 1,
    flag: "typical",
    views_week_delta: null,
    ...over,
  };
}

function channelData(over: Partial<ChannelData> = {}): ChannelData {
  return {
    channel: { id: "c1", title: "Bench Notes", handle: "@benchnotes", subscriber_count: 310 },
    baselines: {
      longform: { format: "longform", median_views: 480, mean_views: 512, sample_size: 12, computed_at: "2026-08-06T06:00:00Z" },
    },
    videos: [video()],
    flagsActive: true,
    lastUpdated: "2026-08-07T06:00:00Z",
    ...over,
  };
}

function rec(over: Partial<Rec> = {}): Rec {
  return {
    id: "r1",
    created_at: "2026-08-06T10:00:00Z",
    agent: "the Marketer",
    category: "packaging",
    recommendation: 'Use the title: "The $12 jig that fixed my dovetails"',
    notes: "Your two best-performing titles both name the price up front.",
    status: "open",
    verdict: null,
    target_type: "channel",
    target_yt_id: null,
    confidence: 62,
    evidence: [{ kind: "library", label: "your own winners" }],
    option_type: "safe",
    result_snapshot: null,
    updates: null,
    ...over,
  };
}

describe("1 — what just happened", () => {
  it("welds the views to what a video of theirs normally gets, and to the move", () => {
    const h = whatJustHappened(channelData({ videos: [video({ flag: "outperformer", view_count: 1240 })] }), []);
    expect(h.kind).toBe("video");
    if (h.kind !== "video") return;
    expect(h.headline).toBe("Beat your usual.");
    expect(h.line).toContain("1,240 views against the 480 a full video of yours normally gets");
    expect(h.line).toContain("worth studying");
    expect(h.tone).toBe("good");
    expect(h.href).toBe("/why/v-uuid");
  });

  it("names a miss as a miss and points at the read, not at a scold", () => {
    const h = whatJustHappened(channelData({ videos: [video({ flag: "underperformer", view_count: 90 })] }), []);
    if (h.kind !== "video") return;
    expect(h.headline).toBe("Fell short.");
    expect(h.actionLabel).toBe("Find out why");
    expect(h.line).toContain("90 views against the 480");
  });

  it("says a Short is measured against Shorts", () => {
    const data = channelData({
      baselines: {
        longform: { format: "longform", median_views: 480, mean_views: 500, sample_size: 12, computed_at: "x" },
        shorts: { format: "shorts", median_views: 60, mean_views: 70, sample_size: 8, computed_at: "x" },
      },
      videos: [video({ is_short: true, flag: "outperformer", view_count: 300 })],
    });
    const h = whatJustHappened(data, []);
    if (h.kind !== "video") return;
    expect(h.line).toContain("300 views against the 60 a Short of yours normally gets");
  });

  // THIN DATA (DESIGN.md §13): a signed-in production account can't show this,
  // so it is proved here — no verdict word, and an honest reason.
  it("refuses to call a win or a miss while the numbers are too small", () => {
    const h = whatJustHappened(channelData({ flagsActive: false, videos: [video({ flag: null, view_count: 14 })] }), []);
    if (h.kind !== "video") return;
    expect(h.headline).toBe("14 views so far — too few to call it.");
    expect(h.line).toContain("one extra viewer swings the whole score");
    expect(h.headline + h.line).not.toMatch(/beat your usual|fell short/i);
    expect(h.tone).toBe("flat");
    expect(h.actionLabel).toBe("See where viewers left");
  });

  it("handles an upload YouTube hasn't counted yet", () => {
    const h = whatJustHappened(channelData({ videos: [video({ view_count: null, flag: null })] }), []);
    if (h.kind !== "video") return;
    expect(h.headline).toBe("No numbers on this one yet.");
    expect(h.line).toContain("usually takes a day");
  });

  it("reads the newest upload, not the newest row", () => {
    const older = video({ id: "old", published_at: "2026-01-01T00:00:00Z" });
    const newer = video({ id: "new", published_at: "2026-08-06T00:00:00Z" });
    const h = whatJustHappened(channelData({ videos: [older, newer] }), []);
    if (h.kind !== "video") return;
    expect(h.video.id).toBe("new");
  });

  it("invites a brand-new channel instead of showing a blank", () => {
    const h = whatJustHappened(channelData({ videos: [] }), []);
    expect(h.kind).toBe("no-video");
  });

  it("leads with the revelation and its receipt when a read exists", () => {
    const reports: DeskReport[] = [
      {
        video_id: "v-uuid", agent: "the team", created_at: "2026-08-06T12:00:00Z",
        data: { reasons: [{ reason: "Nobody found this in search.", evidence: "every one of your 15 views came from a link you shared", agent: "the team" }] },
      },
    ];
    const h = whatJustHappened(channelData(), reports);
    if (h.kind !== "video") return;
    expect(h.revelation?.text).toBe("Nobody found this in search — every one of your 15 views came from a link you shared");
    expect(h.revelation?.provenance).toContain("the team");
    expect(h.noRead).toBeNull();
  });

  it("falls back to the drop read, then to the verdict, then says there is none", () => {
    const drop: DeskReport = {
      video_id: "v-uuid", agent: "the Editor", created_at: "2026-08-06T12:00:00Z",
      data: { drop_reads: [{ at: 134, label: "2:14", likely_cause: "the second recap of what you already said", fix: "cut it" }] },
    };
    expect(revelationFor("v-uuid", [drop])?.text).toBe("Viewers left at 2:14 — the second recap of what you already said");

    const verdict: DeskReport = {
      video_id: "v-uuid", agent: "the Editor", created_at: "2026-08-05T12:00:00Z",
      data: { verdict: "Half your viewers left in the first 20 seconds. The intro is doing the damage." },
    };
    expect(revelationFor("v-uuid", [verdict])?.text).toBe("Half your viewers left in the first 20 seconds.");
    expect(revelationFor("v-uuid", [])).toBeNull();

    const h = whatJustHappened(channelData(), []);
    if (h.kind !== "video") return;
    expect(h.noRead).toContain("No read on this one yet");
  });
});

describe("2 — what to do next", () => {
  it("ranks the best-grounded tip first, then the freshest, and counts the rest", () => {
    const next = whatToDoNext([
      rec({ id: "a", confidence: 40, created_at: "2026-08-06T10:00:00Z" }),
      rec({ id: "b", confidence: 80, created_at: "2026-08-01T10:00:00Z" }),
      rec({ id: "c", confidence: null, created_at: "2026-08-07T10:00:00Z" }),
      rec({ id: "d", confidence: 10, created_at: "2026-08-02T10:00:00Z" }),
      rec({ id: "e", status: "applied" }),
      rec({ id: "f", status: "skipped" }),
    ], []);
    expect(next.actions.map((a) => a.rec.id)).toEqual(["b", "a", "d"]);
    expect(next.more).toBe(1);
  });

  it("tags what the move actually costs — nothing invented", () => {
    expect(effortFor(rec({ category: "packaging" }))).toBe("minimal edit");
    expect(effortFor(rec({ target_type: "idea", category: "content" }))).toBe("new video");
    expect(effortFor(rec({ category: "retention", target_type: "video" }))).toBe("next upload");
  });

  it("puts the title itself on the clipboard, not the sentence around it", () => {
    expect(copyTextFor(rec())).toBe("The $12 jig that fixed my dovetails");
    expect(copyTextFor(rec({ recommendation: "Cut the intro to five seconds" }))).toBe("Cut the intro to five seconds");
  });

  it("offers Studio only where Studio can do the job", () => {
    expect(studioUrlFor(rec({ target_yt_id: "abc123" }))).toBe("https://studio.youtube.com/video/abc123/edit");
    expect(studioUrlFor(rec())).toBe("https://studio.youtube.com/");
    // a video that doesn't exist yet, and a change you can only make on the
    // next upload, have nothing to open
    expect(studioUrlFor(rec({ target_type: "idea", category: "content" }))).toBeNull();
    expect(studioUrlFor(rec({ category: "retention", target_type: "video", target_yt_id: "yt123" }))).toBeNull();
  });

  it("sends each tip to the screen it is worked on", () => {
    const vids = [video({ id: "v-uuid", yt_video_id: "yt123" })];
    expect(whatToDoNext([rec({ target_type: "idea", category: "content" })], vids).actions[0].href).toBe("/ideas");
    expect(whatToDoNext([rec()], vids).actions[0].href).toBe("/packaging");
    expect(whatToDoNext([rec({ category: "retention", target_type: "video", target_yt_id: "yt123" })], vids).actions[0].href).toBe("/why/v-uuid");
    expect(whatToDoNext([rec({ category: "retention", target_type: "video", target_yt_id: "gone" })], vids).actions[0].href).toBe("/ledger");
  });

  it("only calls it a receipt when the words are verbatim", () => {
    const quoted = whatToDoNext([rec({ target_type: "idea", category: "content", notes: '2 viewers asked · "please do a full sharpening video"' })], []);
    expect(quoted.actions[0].receipt?.text).toContain("please do a full sharpening video");
    expect(quoted.actions[0].why).toBeNull();

    const reasoned = whatToDoNext([rec({ notes: "Your two best titles name the price up front." })], []);
    expect(reasoned.actions[0].receipt).toBeNull();
    expect(reasoned.actions[0].why).toBe("Your two best titles name the price up front.");
  });
});

describe("3 — is the advice working", () => {
  it("reports the record with the misses in it", () => {
    const s = isTheAdviceWorking([
      rec({ id: "1", status: "resolved", verdict: "worked" }),
      rec({ id: "2", status: "resolved", verdict: "failed" }),
      rec({ id: "3", status: "resolved", verdict: "mixed" }),
    ], 3, NOW);
    expect(s.lead).toBe("1 worked · 1 mixed · 1 didn't — measured against your own views, so you know which moves to repeat.");
    expect(s.rows).toHaveLength(3);
  });

  it("names only the verdicts that happened — a zero is not a result", () => {
    const s = isTheAdviceWorking([rec({ status: "resolved", verdict: "worked" })], 3, NOW);
    expect(s.lead).toBe("1 worked — measured against your own views, so you know which moves to repeat.");
  });

  it("says plainly that nothing is judged yet rather than faking a verdict", () => {
    const s = isTheAdviceWorking([rec({ status: "applied", updates: [{ type: "applied", at: "2026-08-05T09:00:00Z" }] })], 3, NOW);
    expect(s.lead).toContain("1 tip applied and being watched");
    expect(s.lead).toContain("about a week of fresh numbers");
    expect(s.rows[0].chip).toEqual({ cls: "mut", label: "too early to judge — day 3 of 7" });
  });

  // EMPTY (DESIGN.md §13): nothing on the record — an invitation, not a blank.
  it("invites the first tip when the ledger is empty", () => {
    const s = isTheAdviceWorking([], 3, NOW);
    expect(s.lead).toContain("Nothing on the record yet");
    expect(s.lead).toContain("misses included");
    expect(s.rows).toEqual([]);
  });

  it("keeps open tips out of the score — they belong to the question above", () => {
    const s = isTheAdviceWorking([rec({ status: "open" })], 3, NOW);
    expect(s.rows).toEqual([]);
    expect(s.counts.open).toBe(1);
  });

  it("uses the four verdict states and only those", () => {
    expect(chipFor(rec({ verdict: "worked" }), NOW).label).toBe("✓ worked");
    expect(chipFor(rec({ verdict: "mixed" }), NOW).cls).toBe("warn");
    expect(chipFor(rec({ verdict: "failed" }), NOW).cls).toBe("crit");
    // honesty about thin numbers is never a warning colour (DESIGN.md §7)
    expect(chipFor(rec({ verdict: "unclear" }), NOW).cls).toBe("mut");
  });

  it("caps the Scorekeeper's clock at the week it actually waits", () => {
    expect(appliedDay(rec({ updates: [{ type: "applied", at: "2026-06-01T09:00:00Z" }] }), NOW)).toBeGreaterThan(7);
    expect(chipFor(rec({ status: "applied", updates: [{ type: "applied", at: "2026-06-01T09:00:00Z" }] }), NOW).label)
      .toBe("too early to judge — day 7 of 7");
  });

  it("carries the before→after pair the Scorekeeper measured", () => {
    const s = isTheAdviceWorking([
      rec({ status: "resolved", verdict: "worked", result_snapshot: { metric: "views_per_day", before: 41, after: 128, video_title: "The $12 jig" } }),
    ], 3, NOW);
    expect(s.rows[0].shift).toEqual({ before: 41, after: 128, unit: "views a day" });
    expect(s.rows[0].measuredOn).toBe("The $12 jig");
  });
});
