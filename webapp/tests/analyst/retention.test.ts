import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAnthropic, fakeSvc, post, safeJson, TEST_USER } from "../helpers";

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
vi.mock("@/lib/server/retentionData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRetention: vi.fn(),
}));

import { POST } from "@/app/api/analyst/retention/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { accessTokenFromRow, yt } from "@/lib/server/youtube";
import { fetchRetention } from "@/lib/server/retentionData";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const accessToken = vi.mocked(accessTokenFromRow);
const ytApi = vi.mocked(yt);
const retention = vi.mocked(fetchRetention);

const ANALYSIS = {
  verdict: "Viewers held on until the midpoint, then half left in one step.",
  drop_reads: [
    { at: 0.5, label: "2:30", likely_cause: "The demo pauses for a long aside.", fix: "Cut the aside; get back to the demo." },
  ],
  fixes: [
    {
      recommendation: "Open the next video with the finished result.",
      category: "retention",
      effort: "small tweak",
      expected: "More viewers still watching past the first minute.",
      confidence: 40,
      evidence: [{ kind: "caution", label: "few viewers yet" }],
    },
  ],
  packaging_note: null,
};

const VIDEO_ROW = {
  id: "dbvid1",
  channel_id: "ch1",
  title: "My workshop video",
  published_at: "2026-07-20T00:00:00Z",
  duration_seconds: 300,
  is_short: false,
};

const SNAP = { view_count: 100, views_per_day: 5, captured_at: "2026-08-04T00:00:00Z" };
const REPORT_ROW = { id: "r1", title: 'Why "My workshop video" held or lost viewers', body_md: "## The read", created_at: "2026-08-05T00:00:00Z" };

function happyTables() {
  return {
    google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
    videos: [{ data: VIDEO_ROW }],
    channel_baselines: [{ data: [{ format: "longform", median_views: 120, sample_size: 8 }] }],
    video_snapshots: [{ data: [SNAP] }],
    reports: [{ data: REPORT_ROW, error: null }],
  };
}

const CURVE = {
  points: [
    { x: 0, watch: 1, rel: null },
    { x: 0.5, watch: 0.5, rel: null },
    { x: 1, watch: 0.3, rel: null },
  ],
  drops: [{ x: 0.5, delta: 0.5 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/retention", () => {
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

  it("says so when YouTube has no retention curve yet", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockResolvedValue("access-token");
    retention.mockResolvedValue(null);
    const res = await POST(post({ video: "vidAAAAAAA1" }));
    expect(res.status).toBe(409);
    expect(await safeJson(res)).toEqual({
      error: "YouTube hasn't produced a retention curve for this video yet — the analyst needs it to work.",
    });
  });

  it("reads the curve and returns report, analysis, and the before-numbers", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockResolvedValue("access-token");
    retention.mockResolvedValue(CURVE);
    ytApi.mockResolvedValue({ items: [{ snippet: { description: "My own description" } }] });
    anthropic.mockReturnValue(fakeAnthropic(ANALYSIS).client);

    const res = await POST(post({ video: "vidAAAAAAA1" }));
    expect(res.status).toBe(200);
    expect(await safeJson(res)).toEqual({ report: REPORT_ROW, analysis: ANALYSIS, baseline: SNAP });
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockRejectedValue(new Error("Couldn't refresh YouTube access — reconnect the channel in Settings."));
    const res = await POST(post({ video: "vidAAAAAAA1" }));
    expect(res.status).toBe(502);
    expect(await safeJson(res)).toEqual({
      error: "Couldn't refresh YouTube access — reconnect the channel in Settings.",
    });
  });
});
