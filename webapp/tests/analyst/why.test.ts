import { beforeEach, describe, expect, it, vi } from "vitest";
import { doneOf, errorOf, fakeAnthropic, fakeSvc, post, proseOf, safeJson, safeStream, stagesOf, TEST_USER } from "../helpers";
import { TEAM } from "@/lib/team";

vi.mock("@/lib/server/auth", () => ({ userFromRequest: vi.fn() }));
vi.mock("@/lib/server/service", () => ({ serviceClient: vi.fn() }));
vi.mock("@/lib/server/anthropicClient", () => ({ anthropicClient: vi.fn() }));
vi.mock("@/lib/server/grounding", () => ({
  analystGrounding: vi.fn(async () => ({ audienceBlock: "AUDIENCE", trackBlock: "TRACK" })),
}));
vi.mock("@/lib/server/youtube", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  accessTokenFromRow: vi.fn(),
  yt: vi.fn(),
}));
vi.mock("@/lib/server/publicYt", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVideoComments: vi.fn(),
  typedPhrases: vi.fn(),
}));
vi.mock("@/lib/server/retentionData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRetention: vi.fn(),
}));
vi.mock("@/lib/server/trafficData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchTrafficSources: vi.fn(),
}));

import { POST } from "@/app/api/analyst/why/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { accessTokenFromRow, yt } from "@/lib/server/youtube";
import { fetchVideoComments, typedPhrases } from "@/lib/server/publicYt";
import { fetchRetention } from "@/lib/server/retentionData";
import { fetchTrafficSources } from "@/lib/server/trafficData";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const accessToken = vi.mocked(accessTokenFromRow);
const ytApi = vi.mocked(yt);
const comments = vi.mocked(fetchVideoComments);
const phrases = vi.mocked(typedPhrases);
const retention = vi.mocked(fetchRetention);
const traffic = vi.mocked(fetchTrafficSources);

const ANALYSIS = {
  verdict: "Nearly every view came from links shared outside YouTube; search played no part.",
  reasons: [
    { reason: "The views came from shared links, not YouTube itself.", evidence: "12 of 15 views arrived from outside links.", agent: TEAM.scout.name },
  ],
  devils_advocate: "The boring read: the channel is new and small, and fifteen views is what new channels get. One more upload would tell.",
  actions: [
    {
      type: "safe",
      effort: "minimal edit",
      text: "Retitle this video with the phrase people actually type.",
      category: "packaging",
      why: "Zero search views despite a searchable topic.",
      confidence: 40,
      evidence: [{ kind: "search", label: "people type this" }],
    },
    {
      type: "reach",
      effort: "next upload",
      text: "Open the next one on the question your commenters keep asking.",
      category: "content",
      why: "The only comment you got was a question, and nothing in the video answers it.",
      confidence: 35,
      evidence: [{ kind: "audience", label: "asked in your comments" }],
    },
  ],
};

const VIDEO_ROW = {
  id: "dbvid1",
  channel_id: "ch1",
  title: "My workshop video",
  published_at: "2026-07-20T00:00:00Z",
  duration_seconds: 300,
  is_short: false,
};

const REPORT_ROW = { id: "r1", title: 'Why "My workshop video" did what it did', created_at: "2026-08-05T00:00:00Z" };

function happyTables() {
  return {
    google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
    videos: [{ data: VIDEO_ROW }],
    channels: [{ data: [{ id: "ch1", title: "My Channel", subscriber_count: 42 }] }],
    channel_baselines: [{ data: [{ format: "longform", median_views: 120, sample_size: 8, videos: [{ title: "Winner video", view_count: 500, flag: "outperformer" }] }] }],
    video_snapshots: [{ data: [{ view_count: 15, views_per_day: 2, captured_at: "2026-08-04T00:00:00Z" }] }],
    reports: [{ data: REPORT_ROW, error: null }],
  };
}

let fake: ReturnType<typeof fakeAnthropic>;

function happyMocks() {
  accessToken.mockResolvedValue("access-token");
  ytApi.mockResolvedValue({ items: [{ snippet: { description: "My own description" } }] });
  traffic.mockResolvedValue({ sources: [{ type: "EXT_URL", views: 12 }], searchTerms: [] });
  comments.mockResolvedValue([{ text: "Nice one", likes: 1 }]);
  retention.mockResolvedValue({ points: [], drops: [] });
  phrases.mockResolvedValue(["workshop video tour"]);
  fake = fakeAnthropic(ANALYSIS);
  anthropic.mockReturnValue(fake.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/why", () => {
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

  it("answers the why question and saves the team's report", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();

    const res = await POST(post({ video: "vidAAAAAAA1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const done = doneOf(await safeStream(res));
    expect(done.report).toEqual(REPORT_ROW);
    expect(done.analysis).toEqual(ANALYSIS);
    expect(done.baseline).toEqual({ view_count: 15, views_per_day: 2 });
  });

  it("streams the team's verdict before the report lands", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();

    const events = await safeStream(await POST(post({ video: "vidAAAAAAA1" })));
    expect(proseOf(events)).toBe(ANALYSIS.verdict);
    expect(stagesOf(events)[0]).toBe("The team is gathering everything known about this video…");
    expect(events.findIndex((e) => e.t === "prose")).toBeLessThan(events.findIndex((e) => e.t === "done"));
  });

  it("asks the team for 2-3 typed options with effort tags, never one order", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();
    await safeStream(await POST(post({ video: "vidAAAAAAA1" })));

    const schema = (fake.stream.mock.calls[0][0] as any).output_config.format.schema;
    expect(schema.required).toContain("actions");
    // the single-action shape the review found is gone, not merely unused
    expect(schema.properties.action).toBeUndefined();
    const option = schema.properties.actions.items;
    expect(option.required).toEqual(expect.arrayContaining(["type", "effort"]));
    expect(option.properties.type.enum).toEqual(["safe", "reach", "bold"]);
    // the effort vocabulary is DESIGN.md §8's, not a per-route invention
    expect(option.properties.effort.enum).toEqual([
      "minimal edit", "re-cut", "format change", "next upload", "new video",
    ]);
    expect(schema.properties.actions.description).toMatch(/2 or 3/);
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
