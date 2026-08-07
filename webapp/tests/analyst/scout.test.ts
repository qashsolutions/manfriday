import { beforeEach, describe, expect, it, vi } from "vitest";
import { doneOf, errorOf, fakeAnthropic, fakeSvc, post, proseOf, safeJson, safeStream, stagesOf, TEST_USER } from "../helpers";
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
  fetchVideoComments: vi.fn(),
  typedPhrases: vi.fn(),
}));
vi.mock("@/lib/server/cache", () => ({
  cachedJson: vi.fn(async (_svc: unknown, _key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
}));

import { POST } from "@/app/api/analyst/scout/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { fetchChannelNormal, fetchPublicChannels, fetchPublicVideos, fetchVideoComments, typedPhrases } from "@/lib/server/publicYt";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const accessToken = vi.mocked(accessTokenFromRow);
const videos = vi.mocked(fetchPublicVideos);
const channels = vi.mocked(fetchPublicChannels);
const channelNormal = vi.mocked(fetchChannelNormal);
const comments = vi.mocked(fetchVideoComments);
const phrases = vi.mocked(typedPhrases);

const ANALYSIS = {
  read: "Their video ran a little above their own normal; most of the gap is channel size.",
  factors: [
    { factor: "# of views", theirs: "1000 (1.25× their normal)", yours: "—", note: "Each side is judged against its own channel's normal." },
  ],
  title_read: { their_title: ["Names the payoff up front"], your_title: [], note: "Their title carries a phrase people type." },
  viewers_say: { summary: "Their commenters respond to the tour format.", receipts: [{ quote: "Great video", likes: 10 }], asks: [], your_side: "No own video was chosen, so there is nothing to read on your side." },
  retention_note: "Outside videos' watch time is private, so nothing here can say how long their viewers stayed.",
  you_can_act_on: ["Your title wording"],
  out_of_your_hands: ["Their channel is much larger"],
  options: [
    { type: "safe", takeaway: "Name the payoff in your next title.", category: "packaging", why: "Their winners and yours both do.", confidence: 45, evidence: [{ kind: "library", label: "pattern in their winners" }] },
    { type: "reach", takeaway: "Use the phrase people type for this topic.", category: "packaging", why: "Typed phrases support it.", confidence: 40, evidence: [{ kind: "search", label: "people type this" }] },
    { type: "bold", takeaway: "Try a tour-format video of your own.", category: "content", why: "Untested on your channel.", confidence: 35, evidence: [{ kind: "caution", label: "untested on this channel" }] },
  ],
};

const OUTSIDE_VIDEO: PublicVideo = {
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

const OUTSIDE_CHANNEL: PublicChannel = {
  id: "UCother",
  title: "Other Maker",
  subscriberCount: 5000,
  videoCount: 100,
  publishedAt: "2019-01-01T00:00:00Z",
  uploadsPlaylistId: "UUother",
};

const REPORT_ROW = { id: "r1", title: '"Garage workshop tour" vs your normal', created_at: "2026-08-05T00:00:00Z" };

function happyTables() {
  return {
    google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
    channels: [{ data: [{ id: "ch1", yt_channel_id: "UCmine", title: "My Channel", subscriber_count: 42 }] }],
    channel_baselines: [{ data: [{ format: "longform", median_views: 120, sample_size: 8, computed_at: "2026-08-01T00:00:00Z" }] }],
    reports: [{ data: REPORT_ROW, error: null }],
  };
}

function happyMocks() {
  accessToken.mockResolvedValue("access-token");
  videos.mockResolvedValue([OUTSIDE_VIDEO]);
  channels.mockResolvedValue(new Map([["UCother", OUTSIDE_CHANNEL]]));
  channelNormal.mockResolvedValue({ medianViews: 800, sampleSize: 20, recent: [] });
  comments.mockResolvedValue([{ text: "Great video", likes: 10 }]);
  phrases.mockResolvedValue(["garage workshop tour"]);
  anthropic.mockReturnValue(fakeAnthropic(ANALYSIS).client);
}

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/scout", () => {
  it("rejects unauthenticated requests", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post({ url: "https://www.youtube.com/watch?v=vidAAAAAAA1" }));
    expect(res.status).toBe(401);
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("rejects input that is not a video link or id", async () => {
    const res = await POST(post({ url: "not a link" }));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Paste a YouTube video link (or its 11-character id)." });
  });

  it("refuses to compare the creator's own video as the outside one", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();
    videos.mockResolvedValue([{ ...OUTSIDE_VIDEO, channelId: "UCmine" }]);
    const res = await POST(post({ url: "https://www.youtube.com/watch?v=vidAAAAAAA1" }));
    // The lookup had already begun, so the status is spent — it arrives in-band.
    expect(res.status).toBe(200);
    const events = await safeStream(res);
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "That's one of your own videos — pick it in the 'compare with' box instead, and paste an outside video here.",
    });
    expect(doneOf(events)).toBeUndefined();
  });

  it("compares against the channel's normal and saves the report", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();

    const res = await POST(post({ url: "https://www.youtube.com/watch?v=vidAAAAAAA1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const done = doneOf(await safeStream(res));
    expect(done.report).toEqual(REPORT_ROW);
    expect(done.analysis).toEqual(ANALYSIS);
    expect(done.mine).toBeNull();
    expect(done.video).toEqual({
      id: OUTSIDE_VIDEO.id,
      title: OUTSIDE_VIDEO.title,
      channelTitle: OUTSIDE_VIDEO.channelTitle,
      viewCount: OUTSIDE_VIDEO.viewCount,
      likeCount: OUTSIDE_VIDEO.likeCount,
      commentCount: OUTSIDE_VIDEO.commentCount,
      publishedAt: OUTSIDE_VIDEO.publishedAt,
      durationSeconds: OUTSIDE_VIDEO.durationSeconds,
      subscriberCount: OUTSIDE_CHANNEL.subscriberCount,
      theirRatio: 1.25,
    });
  });

  it("streams the Scout's read before the comparison lands", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();

    const events = await safeStream(await POST(post({ url: "https://www.youtube.com/watch?v=vidAAAAAAA1" })));
    expect(proseOf(events)).toBe(ANALYSIS.read);
    expect(stagesOf(events)[0]).toBe("The Scout is looking up the video you pasted…");
    expect(stagesOf(events).at(-1)).toBe("The Scout is reading both sides…");
    expect(events.findIndex((e) => e.t === "prose")).toBeLessThan(events.findIndex((e) => e.t === "done"));
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    happyMocks();
    accessToken.mockRejectedValue(new Error("Couldn't refresh YouTube access — reconnect the channel in Settings."));
    const events = await safeStream(await POST(post({ url: "https://www.youtube.com/watch?v=vidAAAAAAA1" })));
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "Couldn't refresh YouTube access — reconnect the channel in Settings.",
    });
  });
});
