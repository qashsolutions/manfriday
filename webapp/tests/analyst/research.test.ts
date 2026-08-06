import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAnthropic, fakeSvc, post, safeJson, TEST_USER } from "../helpers";
import type { PublicChannel, PublicVideo } from "@/lib/server/publicYt";

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
  fetchPublicVideos: vi.fn(),
  fetchPublicChannels: vi.fn(),
  fetchChannelNormal: vi.fn(),
  searchPublicVideos: vi.fn(),
  typedPhrases: vi.fn(),
}));
vi.mock("@/lib/server/cache", () => ({
  cachedJson: vi.fn(async (_svc: unknown, _key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
}));

import { POST } from "@/app/api/analyst/research/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { fetchPublicChannels, fetchPublicVideos, searchPublicVideos, typedPhrases } from "@/lib/server/publicYt";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const accessToken = vi.mocked(accessTokenFromRow);
const search = vi.mocked(searchPublicVideos);
const videos = vi.mocked(fetchPublicVideos);
const channels = vi.mocked(fetchPublicChannels);
const phrases = vi.mocked(typedPhrases);

const RESEARCH = {
  title: "The read on: garage workshop videos",
  body_md: "## The lay of the land\n- One video leads the topic.",
  takeaways: [
    { type: "safe", takeaway: "Name the payoff in the title.", category: "packaging", why: "Their winners do.", confidence: 45, evidence: [{ kind: "library", label: "pattern in their winners" }] },
    { type: "reach", takeaway: "Cover the tour angle people type.", category: "content", why: "Typed phrases support it.", confidence: 40, evidence: [{ kind: "search", label: "people type this" }] },
    { type: "bold", takeaway: "Try a budget-build angle.", category: "content", why: "Untested here.", confidence: 35, evidence: [{ kind: "caution", label: "untested on this channel" }] },
  ],
};

const PUBLIC_VIDEO: PublicVideo = {
  id: "vidAAAAAAA1",
  title: "Garage workshop tour",
  description: "A walk through the shop.",
  channelId: "UCother",
  channelTitle: "Other Maker",
  publishedAt: "2026-07-01T00:00:00Z",
  durationSeconds: 300,
  viewCount: 1000,
  likeCount: 50,
  commentCount: 10,
};

const PUBLIC_CHANNEL: PublicChannel = {
  id: "UCother",
  title: "Other Maker",
  subscriberCount: 5000,
  videoCount: 100,
  publishedAt: "2019-01-01T00:00:00Z",
  uploadsPlaylistId: "UUother",
};

const REPORT_ROW = { id: "r1", title: RESEARCH.title, body_md: RESEARCH.body_md, created_at: "2026-08-05T00:00:00Z" };

function happyTables() {
  return {
    google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
    channels: [{ data: [{ id: "ch1", title: "My Channel", subscriber_count: 42 }] }],
    reports: [{ data: REPORT_ROW, error: null }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/research", () => {
  it("rejects unauthenticated requests", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post({ query: "garage workshop" }));
    expect(res.status).toBe(401);
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("rejects an empty query", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Give the Researcher a topic or a video link." });
  });

  it("researches a topic and saves the report", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockResolvedValue("access-token");
    search.mockResolvedValue(["vidAAAAAAA1"]);
    videos.mockResolvedValue([PUBLIC_VIDEO]);
    channels.mockResolvedValue(new Map([["UCother", PUBLIC_CHANNEL]]));
    phrases.mockResolvedValue(["garage workshop ideas"]);
    anthropic.mockReturnValue(fakeAnthropic(RESEARCH).client);

    const res = await POST(post({ query: "garage workshop" }));
    expect(res.status).toBe(200);
    expect(await safeJson(res)).toEqual({ report: REPORT_ROW, takeaways: RESEARCH.takeaways });
  });

  it("says so when YouTube returns nothing for the topic", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockResolvedValue("access-token");
    search.mockResolvedValue([]);
    const res = await POST(post({ query: "garage workshop" }));
    expect(res.status).toBe(404);
    expect(await safeJson(res)).toEqual({ error: "YouTube returned nothing for that — try different words." });
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockRejectedValue(new Error("Couldn't refresh YouTube access — reconnect the channel in Settings."));
    const res = await POST(post({ query: "garage workshop" }));
    expect(res.status).toBe(502);
    expect(await safeJson(res)).toEqual({
      error: "Couldn't refresh YouTube access — reconnect the channel in Settings.",
    });
  });
});
