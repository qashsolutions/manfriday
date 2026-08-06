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
}));

import { POST } from "@/app/api/analyst/ideas/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { fetchVideoComments } from "@/lib/server/publicYt";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const accessToken = vi.mocked(accessTokenFromRow);
const comments = vi.mocked(fetchVideoComments);

const MINED = {
  summary: "Viewers keep asking for a sharpening follow-up.",
  ideas: [
    {
      title: "Chisel sharpening, start to finish",
      ask_count: 2,
      receipt_quote: "Please make a full sharpening video",
      receipt_likes: 3,
      note: "Two commenters asked for this directly.",
      confidence: 40,
      evidence: [{ kind: "audience", label: "viewers asked directly" }],
    },
  ],
};

/** Enough recent uploads that "all at once" is distinguishable from "one
    after another". */
const VIDEO_COUNT = 4;

function happyTables(videoCount = 1) {
  return {
    google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
    channels: [{ data: [{ id: "ch1", yt_channel_id: "UCmine" }] }],
    videos: [{
      data: Array.from({ length: videoCount }, (_, i) => ({
        yt_video_id: `vidAAAAAAA${i + 1}`, title: `Video ${i + 1}`,
      })),
    }],
    recommendations: [{ data: [] }, { error: null }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/ideas", () => {
  it("rejects unauthenticated requests", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("asks to connect a channel first when none is connected", async () => {
    service.mockReturnValue(fakeSvc({ google_oauth_tokens: [{ data: null }], channels: [{ data: [] }] }).svc);
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Connect your channel first." });
  });

  it("mines ideas from comments and lands new ones in the ledger", async () => {
    const { svc, inserts } = fakeSvc(happyTables());
    service.mockReturnValue(svc);
    accessToken.mockResolvedValue("access-token");
    comments.mockResolvedValue([{ text: "Please make a full sharpening video", likes: 3 }]);
    anthropic.mockReturnValue(fakeAnthropic(MINED).client);

    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await safeStream(res);
    const done = doneOf(events);
    expect(done.summary).toBe(MINED.summary);
    expect(done.found).toBe(1);
    expect(done.added).toBe(1);
    expect(proseOf(events)).toBe(MINED.summary);
    expect(inserts.recommendations).toHaveLength(1);
  });

  it("opens every video's comments at once, not one after another", async () => {
    service.mockReturnValue(fakeSvc(happyTables(VIDEO_COUNT)).svc);
    accessToken.mockResolvedValue("access-token");
    anthropic.mockReturnValue(fakeAnthropic(MINED).client);

    // Each call resolves only once every call has been made — which can only
    // happen if they were all in flight together.
    let started = 0;
    let release!: () => void;
    const allStarted = new Promise<void>((r) => { release = r; });
    comments.mockImplementation(async () => {
      if (++started === VIDEO_COUNT) release();
      await allStarted;
      return [{ text: "Please make a full sharpening video", likes: 3 }];
    });

    const events = await safeStream(await POST(post()));
    expect(doneOf(events)).toBeDefined();
    expect(comments).toHaveBeenCalledTimes(VIDEO_COUNT);
    expect(stagesOf(events)).toContain(`Opening the comments on your ${VIDEO_COUNT} most recent videos…`);
  });

  it("says so honestly when there are no comments to read yet", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockResolvedValue("access-token");
    comments.mockResolvedValue([]);
    const res = await POST(post());
    expect(res.status).toBe(200);
    const events = await safeStream(res);
    expect(errorOf(events)).toEqual({
      t: "error",
      error: `No comments to read yet — ${TEAM.listener.name} needs viewers talking first.`,
    });
    expect(doneOf(events)).toBeUndefined();
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockRejectedValue(new Error("Couldn't refresh YouTube access — reconnect the channel in Settings."));
    const events = await safeStream(await POST(post()));
    expect(errorOf(events)).toEqual({
      t: "error",
      error: "Couldn't refresh YouTube access — reconnect the channel in Settings.",
    });
  });
});
