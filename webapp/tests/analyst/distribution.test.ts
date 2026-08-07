import { beforeEach, describe, expect, it, vi } from "vitest";
import { doneOf, errorOf, fakeAnthropic, fakeSvc, post, proseOf, safeJson, safeStream, stagesOf, TEST_USER } from "../helpers";

vi.mock("@/lib/server/auth", () => ({ userFromRequest: vi.fn() }));
vi.mock("@/lib/server/service", () => ({ serviceClient: vi.fn() }));
vi.mock("@/lib/server/anthropicClient", () => ({ anthropicClient: vi.fn() }));
vi.mock("@/lib/server/grounding", () => ({
  analystGrounding: vi.fn(async () => ({ audienceBlock: "AUDIENCE", trackBlock: "TRACK" })),
}));
vi.mock("@/lib/server/youtube", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  accessTokenFromRow: vi.fn(),
}));
// Only the two network reads are faked — the bucketing, the floor and the
// window arithmetic are the real ones, because they are what the read is.
vi.mock("@/lib/server/trafficData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchTrafficSources: vi.fn(),
  fetchTrafficWindows: vi.fn(),
}));

import { POST } from "@/app/api/analyst/distribution/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { fetchTrafficSources, fetchTrafficWindows } from "@/lib/server/trafficData";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const accessToken = vi.mocked(accessTokenFromRow);
const lifetime = vi.mocked(fetchTrafficSources);
const windows = vi.mocked(fetchTrafficWindows);

const ANALYSIS = {
  state: "distribution",
  verdict:
    "**In short** — views from YouTube's suggestions fell from 185 to 32 while the people who already follow " +
    "you held at 38, so the video didn't get worse — YouTube simply stopped putting it in front of strangers.",
  where_from: "Almost every view arrived through YouTube suggesting it beside another video, so this one lives or dies on that feed.",
  what_changed: "Last week YouTube's suggestions sent 32 views, against 185 the week before; the people who already follow you barely moved, 38 against 40.",
  control_test: "The people who already follow you held at 38 while YouTube's own feed fell from 185 to 32 — that's the distribution moving, not your video.",
  steady_note: "A video's numbers commonly keep moving for one to two weeks; this one is past that, so the fall is real rather than the numbers still settling.",
  options: [
    {
      type: "safe",
      effort: "minimal edit",
      text: "Retitle this video around the question your commenters keep asking.",
      category: "packaging",
      why: "Nobody found it by searching — every view came from a feed you don't control, so a searchable title adds a way in that can't be switched off.",
      confidence: 45,
      evidence: [{ kind: "search", label: "people type this" }],
    },
    {
      type: "reach",
      effort: "next upload",
      text: "Make the follow-up the same audience already binges.",
      category: "content",
      why: "Suggestions dried out as the topic went quiet, and a fresh video is what restarts that feed.",
      confidence: 35,
      evidence: [{ kind: "caution", label: "one video, one week" }],
    },
  ],
};

const VIDEO_ROW = {
  id: "dbvid1",
  channel_id: "ch1",
  title: "My workshop video",
  published_at: "2026-01-20T00:00:00Z",
  is_short: false,
};

const REPORT_ROW = {
  id: "r1",
  title: 'How viewers found "My workshop video" — and what changed',
  created_at: "2026-08-05T00:00:00Z",
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function happyTables(video: Record<string, unknown> = VIDEO_ROW) {
  return {
    google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
    videos: [{ data: video }],
    channels: [{ data: [{ id: "ch1", title: "My Channel", subscriber_count: 420 }] }],
    channel_baselines: [{ data: [{ format: "longform", median_views: 120, sample_size: 8 }] }],
    video_snapshots: [{ data: [{ view_count: 1360, views_per_day: 9, captured_at: "2026-08-04T00:00:00Z" }] }],
    reports: [{ data: REPORT_ROW, error: null }],
  };
}

/** The shape the control test exists for: YouTube's feed collapsed, the people
    who already follow the channel kept showing up. */
const MOVED = {
  recent: {
    from: "x", to: "y",
    sources: [{ type: "RELATED_VIDEO", views: 30 }, { type: "SUBSCRIBER", views: 40 }],
    subscriberDetail: [{ detail: "/my_subscriptions", views: 38 }, { detail: "/", views: 2 }],
  },
  prior: {
    from: "x", to: "y",
    sources: [{ type: "RELATED_VIDEO", views: 180 }, { type: "SUBSCRIBER", views: 45 }],
    subscriberDetail: [{ detail: "/my_subscriptions", views: 40 }, { detail: "/", views: 5 }],
  },
};

/** Two weeks that between them can't fill a room. */
const QUIET = {
  recent: { from: "x", to: "y", sources: [{ type: "EXT_URL", views: 4 }], subscriberDetail: [] },
  prior: { from: "x", to: "y", sources: [{ type: "EXT_URL", views: 7 }], subscriberDetail: [] },
};

let fake: ReturnType<typeof fakeAnthropic>;

function happyMocks(w: typeof MOVED = MOVED) {
  accessToken.mockResolvedValue("access-token");
  lifetime.mockResolvedValue({
    sources: [
      { type: "RELATED_VIDEO", views: 900 },
      { type: "SUBSCRIBER", views: 300 },
      { type: "YT_SEARCH", views: 120 },
      { type: "EXT_URL", views: 40 },
    ],
    searchTerms: [],
  });
  windows.mockResolvedValue(w as never);
  fake = fakeAnthropic(ANALYSIS);
  anthropic.mockReturnValue(fake.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/distribution", () => {
  it("rejects unauthenticated requests", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post({ video: "vidAAAAAAA1" }));
    expect(res.status).toBe(401);
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("rejects a missing video id", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Missing video id" });
  });

  it("rejects a video that isn't in the analysis yet", async () => {
    service.mockReturnValue(fakeSvc({
      google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
      videos: [{ data: null }],
      channels: [{ data: [{ id: "ch1", title: "My Channel", subscriber_count: 420 }] }],
    }).svc);
    const res = await POST(post({ video: "vidAAAAAAA1" }));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({
      error: "This video isn't in your analysis yet — run the first analysis on the Desk.",
    });
  });

  it("reads the whole distribution and saves it as the team's report", async () => {
    const { svc, inserts } = fakeSvc(happyTables());
    service.mockReturnValue(svc);
    happyMocks();

    const res = await POST(post({ video: "vidAAAAAAA1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await safeStream(res);
    const done = doneOf(events);
    expect(done.state).toBe("distribution");
    expect(done.analysis).toEqual(ANALYSIS);
    expect(done.report).toEqual(REPORT_ROW);
    expect(done.reason).toBeNull();
    expect(done.baseline).toEqual({ view_count: 1360, views_per_day: 9, captured_at: "2026-08-04T00:00:00Z" });
    expect(done.checkBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(done.windows.recentFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The stored report has to be tellable apart from the team's why-verdict:
    // both are signed by the team, so the shape carries the difference.
    const stored = (inserts.reports?.[0] ?? {}) as Record<string, any>;
    expect(stored.agent).toBe("the team");
    expect(stored.data.kind).toBe("distribution");
    expect(stored.data.found[0].label).toBe("YouTube suggested it beside another video");
    expect(stored.video_id).toBe("dbvid1");
  });

  it("hands over the verdict as it is written, before the report lands", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();

    const events = await safeStream(await POST(post({ video: "vidAAAAAAA1" })));
    expect(proseOf(events)).toBe(ANALYSIS.verdict);
    expect(stagesOf(events)[0]).toBe("The team is pulling up how viewers found this one…");
    expect(events.findIndex((e) => e.t === "prose")).toBeLessThan(events.findIndex((e) => e.t === "done"));
  });

  it("never lets a raw YouTube source name reach the reader", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();

    const events = await safeStream(await POST(post({ video: "vidAAAAAAA1" })));
    const wire = JSON.stringify(events);
    for (const jargon of ["YT_SEARCH", "RELATED_VIDEO", "SUBSCRIBER", "EXT_URL", "insightTrafficSource"]) {
      expect(wire, `the wire leaked ${jargon}`).not.toContain(jargon);
    }
    const done = doneOf(events);
    expect(done.found.map((f: { label: string }) => f.label)).toContain("people searched YouTube and found it");
    expect(done.change.map((c: { label: string }) => c.label)).toEqual(
      expect.arrayContaining(["YouTube putting it in front of people", "people who already follow you"])
    );
  });

  it("gives the analyst only the causes YouTube itself publishes, plus both misreadings", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();
    await safeStream(await POST(post({ video: "vidAAAAAAA1" })));

    const call = fake.stream.mock.calls[0][0] as any;
    const material = String(call.messages[0].content);
    expect(material).toContain("The audience is watching something else right now");
    expect(material).toContain("The topic is saturated");
    expect(material).toContain("Supply and demand in this subject shifted");
    expect(material).toContain("Seasonality");
    expect(material).toContain("the only causes you may name");
    // the two panic defusers, verbatim enough to be recognisable
    expect(material).toContain("the average time watched FALLS");
    expect(material).toContain("keep moving for one to two weeks");
    // the control test, with both sides named
    expect(material).toContain("People who already follow you");
    // 185, not 180: the 5 home-page views YouTube filed under the subscriptions
    // pile belong to the algorithm's side of the control test, not the follower's
    expect(material).toContain("32 views last week, 185 the week before");
    expect(material).toContain("people who already follow you: 38 views last week, 40 the week before");
    // and nothing this API can't support
    expect(call.system).toContain("Never claim how often a thumbnail was shown or clicked");
  });

  it("asks for 2-3 typed responses that the Ledger can actually file", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();
    await safeStream(await POST(post({ video: "vidAAAAAAA1" })));

    const option = (fake.stream.mock.calls[0][0] as any).output_config.format.schema.properties.options;
    expect(option.description).toMatch(/2 or 3/);
    expect(option.items.required).toEqual(
      expect.arrayContaining(["type", "effort", "category", "confidence", "evidence"])
    );
    expect(option.items.properties.type.enum).toEqual(["safe", "reach", "bold"]);
    // DESIGN.md §8's effort vocabulary, not a per-route invention
    expect(option.items.properties.effort.enum).toEqual([
      "minimal edit", "re-cut", "format change", "next upload", "new video",
    ]);
    // every value here has to survive the recommendations category constraint
    expect(option.items.properties.category.enum).toEqual(["packaging", "content", "retention"]);
  });

  it("says a video too new to compare is too new — and never pays for a read", async () => {
    service.mockReturnValue(fakeSvc(happyTables({ ...VIDEO_ROW, published_at: daysAgo(3) })).svc);
    happyMocks();

    const events = await safeStream(await POST(post({ video: "vidAAAAAAA1" })));
    const done = doneOf(events);
    expect(done.state).toBe("too_early");
    expect(done.reasonKind).toBe("too_new");
    expect(done.reason).toContain("3 days old");
    expect(done.reason).toContain("From day 15");
    expect(done.analysis).toBeNull();
    expect(done.report).toBeNull();
    expect(done.change).toBeNull();
    expect(done.checkBy).toBeNull();
    // the honest state is not a blank one: where the views came from is a fact
    expect(done.found).toHaveLength(4);
    expect(done.foundTotal).toBe(1360);
    // the floor is arithmetic, so no model was asked to be honest about it
    expect(fake.stream).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("says two quiet weeks are too quiet to read — and never pays for a read", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks(QUIET);

    const events = await safeStream(await POST(post({ video: "vidAAAAAAA1" })));
    const done = doneOf(events);
    expect(done.state).toBe("too_early");
    expect(done.reasonKind).toBe("too_quiet");
    expect(done.reason).toContain("11 views in total");
    expect(done.reason).toContain("week-to-week wobble");
    expect(done.analysis).toBeNull();
    expect(fake.stream).not.toHaveBeenCalled();
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();
    accessToken.mockRejectedValue(new Error("Couldn't refresh YouTube access — reconnect the channel in Settings."));

    const events = await safeStream(await POST(post({ video: "vidAAAAAAA1" })));
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "Couldn't refresh YouTube access — reconnect the channel in Settings.",
    });
  });
});
