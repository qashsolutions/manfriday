import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSvc, TEST_USER } from "../helpers";

vi.mock("@/lib/server/retentionData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRetention: vi.fn(),
}));

import { checkAppliedTips, direction, heldAt, holdMark, spread, VERDICT_KINDS } from "@/lib/server/scorekeeper";
import { fetchRetention } from "@/lib/server/retentionData";

const curves = vi.mocked(fetchRetention);

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const appliedDaysAgo = (days: number) => [{ type: "applied", at: ago(days) }];

/** A curve whose value at the 0:30 mark (x = 0.05 on a ten-minute video) is
    exactly `atMark` — the only point these tests care about. */
const curve = (atMark: number) => ({
  points: [
    { x: 0, watch: 1, rel: null },
    { x: 0.025, watch: 0.8, rel: null },
    { x: 0.05, watch: atMark, rel: null },
    { x: 0.1, watch: atMark - 0.05, rel: null },
    { x: 0.5, watch: 0.2, rel: null },
  ],
  drops: [],
});

/** Causal assertion, in either direction. A what-happened note states what
    moved and stops; the moment it explains, it is claiming something views
    alone cannot show. */
const CAUSAL = /\b(because|caused?|causes|thanks to|drove|led to|proved?|proves|resulted in|worked|did it|made it|responsible)\b/i;

type Update = {
  status: string;
  verdict: string;
  verdict_kind: string;
  result_snapshot: Record<string, any>;
  updates: { type: string; verdict?: string; kind?: string }[];
};

/** Every verdict the Scorekeeper writes, whatever the path, obeys these. */
function assertTaxonomy(u: Update) {
  expect(VERDICT_KINDS).toContain(u.verdict_kind);
  // No API exposes Test & Compare results, so this kind can only ever arrive
  // creator-reported — the Scorekeeper must never mint one.
  expect(u.verdict_kind).not.toBe("head_to_head");
  expect(typeof u.result_snapshot.claim).toBe("string");
  expect(u.updates.at(-1)).toMatchObject({ type: "verdict", verdict: u.verdict, kind: u.verdict_kind });
  if (u.verdict_kind === "what_happened") {
    expect(u.result_snapshot.claim).toMatch(/What happened, not why\.$/);
    expect(u.result_snapshot.claim).not.toMatch(CAUSAL);
  }
}

const RETENTION_TIP = {
  id: "rec-1",
  category: "retention",
  target_type: "video",
  target_yt_id: "vid1",
  baseline: { views_per_day: 10 },
  updates: appliedDaysAgo(10),
  updated_at: ago(10),
};

const TARGET_VIDEO = { data: { id: "v1", title: "The workshop build", duration_seconds: 600 } };

/** Newest first, the way the query asks for them. The five older rows sit
    inside the fortnight before the tip was applied — this video's own bounce. */
const SNAPSHOTS = {
  data: [
    { views_per_day: 30, view_count: 900, captured_at: ago(1) },
    { views_per_day: 5, view_count: 400, captured_at: ago(11) },
    { views_per_day: 8, view_count: 380, captured_at: ago(12) },
    { views_per_day: 12, view_count: 350, captured_at: ago(13) },
    { views_per_day: 20, view_count: 300, captured_at: ago(14) },
    { views_per_day: 40, view_count: 260, captured_at: ago(15) },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the Scorekeeper's verdict taxonomy", () => {
  it("reads the curve when it can: viewers stayed longer, in viewers not views", async () => {
    // Called in array order: the before-window first, the after-window second.
    curves.mockResolvedValueOnce(curve(0.5)).mockResolvedValueOnce(curve(0.62));
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [RETENTION_TIP] }],
      videos: [{ data: [] }, TARGET_VIDEO],
      channel_baselines: [{ data: [] }],
      video_snapshots: [SNAPSHOTS],
    });

    expect(await checkAppliedTips(svc, TEST_USER.id, "tok")).toBe(1);
    const u = updates.recommendations[0] as Update;
    assertTaxonomy(u);
    expect(u.verdict_kind).toBe("viewers_stayed");
    expect(u.verdict).toBe("worked");
    expect(u.result_snapshot).toMatchObject({ measured: "retention", mark: "0:30", held_before: 50, held_after: 62 });
    expect(u.result_snapshot.claim).toContain("62 of every 100 reach 0:30, up from 50");
  });

  it("without both curves it drops to a what-happened note — never a cause", async () => {
    curves.mockResolvedValue(null);
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [RETENTION_TIP] }],
      videos: [{ data: [] }, TARGET_VIDEO],
      channel_baselines: [{ data: [] }],
      video_snapshots: [SNAPSHOTS],
    });

    expect(await checkAppliedTips(svc, TEST_USER.id, "tok")).toBe(1);
    const u = updates.recommendations[0] as Update;
    assertTaxonomy(u);
    expect(u.verdict_kind).toBe("what_happened");
    expect(u.result_snapshot.claim).toContain("Views went 10 a day → 30 a day");
    // The keys the Ledger already renders survive untouched.
    expect(u.result_snapshot).toMatchObject({ metric: "views_per_day", before: 10, after: 30, ratio: 3 });
  });

  it("tripling is not a result on a video whose own numbers already bounce that far", async () => {
    curves.mockResolvedValue(null);
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [RETENTION_TIP] }],
      videos: [{ data: [] }, TARGET_VIDEO],
      channel_baselines: [{ data: [] }],
      video_snapshots: [SNAPSHOTS],
    });

    await checkAppliedTips(svc, TEST_USER.id, "tok");
    const u = updates.recommendations[0] as Update;
    // 10 a day → 30 a day is 3×, and this video bounced 5–40 a day on its own
    // before anything changed. The old rule called that "worked".
    expect(u.verdict).toBe("mixed");
    expect(u.result_snapshot.claim).toContain("already bounced between 5 and 40");
    expect(u.result_snapshot.claim).toContain("inside that bounce");
  });

  it("…and the same 3× IS called on a video whose numbers hold steady", async () => {
    curves.mockResolvedValue(null);
    const steady = {
      data: [
        { views_per_day: 30, view_count: 900, captured_at: ago(1) },
        { views_per_day: 10, view_count: 400, captured_at: ago(11) },
        { views_per_day: 11, view_count: 380, captured_at: ago(12) },
        { views_per_day: 9, view_count: 350, captured_at: ago(13) },
        { views_per_day: 10, view_count: 300, captured_at: ago(14) },
        { views_per_day: 11, view_count: 260, captured_at: ago(15) },
      ],
    };
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [RETENTION_TIP] }],
      videos: [{ data: [] }, TARGET_VIDEO],
      channel_baselines: [{ data: [] }],
      video_snapshots: [steady],
    });

    await checkAppliedTips(svc, TEST_USER.id, "tok");
    const u = updates.recommendations[0] as Update;
    expect(u.verdict).toBe("worked");
    expect(u.verdict_kind).toBe("what_happened"); // still an observation, however clean
  });

  it("judges a packaging pick against the normal as it stood when they applied it", async () => {
    const packagingPick = {
      id: "rec-2",
      category: "packaging",
      target_type: "channel",
      target_yt_id: null,
      baseline: {},
      updates: appliedDaysAgo(10),
      updated_at: ago(10),
    };
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [packagingPick] }],
      videos: [{ data: [{ id: "nv1", yt_video_id: "newvid", title: "The one after", published_at: ago(8), is_short: false }] }],
      channel_baselines: [{
        data: [
          // Newest first, the way the query asks. The newest was computed after
          // they applied — and already contains the video being judged.
          { format: "longform", median_views: 400, sample_size: 10, videos: [], computed_at: ago(2) },
          {
            format: "longform", median_views: 100, sample_size: 8, computed_at: ago(12),
            videos: [{ view_count: 20 }, { view_count: 60 }, { view_count: 100 }, { view_count: 150 }, { view_count: 600 }],
          },
        ],
      }],
      video_snapshots: [{ data: [{ view_count: 300 }] }],
    });

    expect(await checkAppliedTips(svc, TEST_USER.id, "tok")).toBe(1);
    const u = updates.recommendations[0] as Update;
    assertTaxonomy(u);
    expect(u.verdict_kind).toBe("what_happened");
    expect(u.result_snapshot).toMatchObject({ metric: "views_vs_normal", before: 100, after: 300, normal_from: ago(12) });
    expect(u.result_snapshot.claim).toContain("Your usual is about 100");
    expect(u.result_snapshot.claim).toContain("between 20 and 600 views");
    // 300 against a usual 100 is 3× — and inside a channel that lands anywhere
    // from 20 to 600. Not a result.
    expect(u.verdict).toBe("mixed");
  });

  it("says nothing while a tip is still being watched", async () => {
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [{ ...RETENTION_TIP, updates: appliedDaysAgo(10) }] }],
      videos: [{ data: [] }, { data: null }], // the target video isn't in the library
      channel_baselines: [{ data: [] }],
    });

    expect(await checkAppliedTips(svc, TEST_USER.id, "tok")).toBe(0);
    expect(updates.recommendations).toBeUndefined();
  });

  it("after four weeks of nothing, too early to judge is the verdict — said plainly", async () => {
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [{ ...RETENTION_TIP, updates: appliedDaysAgo(30), updated_at: ago(30) }] }],
      videos: [{ data: [] }, { data: null }],
      channel_baselines: [{ data: [] }],
    });

    expect(await checkAppliedTips(svc, TEST_USER.id, "tok")).toBe(1);
    const u = updates.recommendations[0] as Update;
    assertTaxonomy(u);
    expect(u.verdict_kind).toBe("too_early");
    expect(u.verdict).toBe("unclear");
    expect(u.result_snapshot.claim).toContain("Still too thin to judge");
    expect(u.result_snapshot.claim).toContain("up to two weeks");
    expect(u.result_snapshot.reason).toContain("no longer in your library");
  });

  it("leaves a tip alone until a week of fresh numbers has passed", async () => {
    const { svc, updates } = fakeSvc({
      recommendations: [{ data: [{ ...RETENTION_TIP, updates: appliedDaysAgo(3) }] }],
    });
    expect(await checkAppliedTips(svc, TEST_USER.id, "tok")).toBe(0);
    expect(updates.recommendations).toBeUndefined();
    expect(curves).not.toHaveBeenCalled();
  });
});

describe("the arithmetic underneath", () => {
  it("a swing only ever raises the bar, never lowers it", () => {
    expect(direction(3, null)).toBe("worked");
    expect(direction(3, { low: 5, high: 40, mid: 12 })).toBe("mixed"); // bounces 0.4×–3.3×
    expect(direction(4, { low: 5, high: 40, mid: 12 })).toBe("worked");
    // A channel steadier than the flat thresholds doesn't get an easier ride.
    expect(direction(1.2, { low: 95, high: 105, mid: 100 })).toBe("mixed");
    expect(direction(0.8, { low: 95, high: 105, mid: 100 })).toBe("mixed");
  });

  it("won't describe a swing from fewer than five numbers", () => {
    expect(spread([10, 20, 30, 40])).toBeNull();
    expect(spread([10, 20, 30, 40, 50])).toEqual({ low: 10, high: 50, mid: 30 });
    expect(spread([null, 0, 10, 20, 30, 40, 50])).toEqual({ low: 10, high: 50, mid: 30 });
  });

  it("holds the mark at 0:30, or halfway through a Short", () => {
    expect(holdMark(600)).toEqual({ x: 0.05, label: "0:30" });
    expect(holdMark(45)).toEqual({ x: 0.5, label: "0:23" });
    expect(holdMark(null)).toEqual({ x: 0.5, label: "halfway" });
  });

  it("counts viewers still there at the mark, and never more than everyone", () => {
    expect(heldAt(curve(0.5).points, 0.05)).toBe(50);
    expect(heldAt(curve(1.4).points, 0.05)).toBe(100); // re-watching isn't 140 of 100
    expect(heldAt([{ x: 0, watch: 1, rel: null }], 0.05)).toBeNull();
  });
});
