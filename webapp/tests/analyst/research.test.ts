import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  doneOf, errorOf, fakeAnthropic, fakeSvc, post, proseOf, safeJson, safeStream, stagesOf, TEST_USER,
} from "../helpers";
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
  // Carries the "In short" opener, a newline escape and a quoted phrase — the
  // shapes the incremental reader has to decode correctly mid-chunk.
  body_md:
    "**In short** — Short \"tour\" builds travel furthest here.\n\n## The lay of the land\n- One video leads the topic.",
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

  function happyPath() {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    accessToken.mockResolvedValue("access-token");
    search.mockResolvedValue(["vidAAAAAAA1"]);
    videos.mockResolvedValue([PUBLIC_VIDEO]);
    channels.mockResolvedValue(new Map([["UCother", PUBLIC_CHANNEL]]));
    phrases.mockResolvedValue(["garage workshop ideas"]);
    const fake = fakeAnthropic(RESEARCH);
    anthropic.mockReturnValue(fake.client);
    return fake;
  }

  it("reaches the model exactly once for one request", async () => {
    const fake = happyPath();
    await safeStream(await POST(post({ query: "garage workshop" })));
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("hands the request's abort signal to the model call, and never retries", async () => {
    const fake = happyPath();
    const ac = new AbortController();
    await safeStream(await POST(post({ query: "garage workshop" }, ac.signal)));

    // Second argument is the SDK's RequestOptions. Request builds its own
    // signal that follows the one it was given, so identity won't match —
    // what matters is that aborting the caller aborts what the model got.
    const opts = fake.stream.mock.calls[0][1] as { signal?: AbortSignal; maxRetries?: number };
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.signal!.aborted).toBe(false);
    ac.abort();
    expect(opts.signal!.aborted).toBe(true);

    // The SDK would otherwise re-run the whole generation up to twice more.
    expect(opts.maxRetries).toBe(0);
  });


  it("stops generating when the reader walks away", async () => {
    const fake = happyPath();
    const ac = new AbortController();
    ac.abort(); // the tab is already gone by the time the model would run

    const res = await POST(post({ query: "garage workshop" }, ac.signal));
    const events = await safeStream(res);

    // The generation was cut off, so no read was produced…
    expect(doneOf(events)).toBeUndefined();
    // …and an abandoned request is not dressed up as an error nobody can read.
    expect(errorOf(events)).toBeUndefined();
    expect(events).toEqual([]);
    expect(fake.stream).toHaveBeenCalledTimes(1);
  });

  it("researches a topic and saves the report", async () => {
    happyPath();
    const res = await POST(post({ query: "garage workshop" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await safeStream(res);
    const done = doneOf(events);
    expect(done.report).toEqual(REPORT_ROW);
    expect(done.takeaways).toEqual(RESEARCH.takeaways);
  });

  it("streams the read as prose before the report lands", async () => {
    happyPath();
    const events = await safeStream(await POST(post({ query: "garage workshop" })));

    // The reader watched the whole body arrive, decoded, in order.
    expect(proseOf(events)).toBe(RESEARCH.body_md);
    expect(proseOf(events).startsWith("**In short** —")).toBe(true);

    const firstProse = events.findIndex((e) => e.t === "prose");
    const finished = events.findIndex((e) => e.t === "done");
    expect(firstProse).toBeGreaterThan(-1);
    expect(firstProse).toBeLessThan(finished);
    expect(finished).toBe(events.length - 1);
  });

  it("narrates the real gather steps before the analyst writes", async () => {
    happyPath();
    const events = await safeStream(await POST(post({ query: "garage workshop" })));
    const stages = stagesOf(events);

    expect(stages[0]).toBe("The Researcher is pulling the top results for “garage workshop”…");
    // The counts are the ones actually fetched, not a guess.
    expect(stages).toContain("Reading 1 title across 1 channel…");
    expect(stages.at(-1)).toBe("The Researcher is writing your read…");
    // Every stage precedes the first word of the read.
    expect(events.findIndex((e) => e.t === "stage")).toBeLessThan(events.findIndex((e) => e.t === "prose"));
    expect(events.filter((e) => e.t === "stage").length).toBe(stages.length);
  });

  it("reports how long the gather and the read each took", async () => {
    happyPath();
    const done = doneOf(await safeStream(await POST(post({ query: "garage workshop" }))));
    expect(done.timing.gatherMs).toBeGreaterThanOrEqual(0);
    expect(done.timing.modelMs).toBeGreaterThanOrEqual(0);
    expect(done.timing.firstWordMs).toBeGreaterThanOrEqual(0);
    expect(done.timing.totalMs).toBeGreaterThanOrEqual(done.timing.firstWordMs);
  });

  it("says so when YouTube returns nothing for the topic", async () => {
    happyPath();
    search.mockResolvedValue([]);
    const res = await POST(post({ query: "garage workshop" }));
    // The read had already begun, so the status is spent — it arrives in-band.
    expect(res.status).toBe(200);
    const events = await safeStream(res);
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "YouTube returned nothing for that — try different words.",
    });
    expect(doneOf(events)).toBeUndefined();
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    happyPath();
    accessToken.mockRejectedValue(new Error("Couldn't refresh YouTube access — reconnect the channel in Settings."));
    const events = await safeStream(await POST(post({ query: "garage workshop" })));
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "Couldn't refresh YouTube access — reconnect the channel in Settings.",
    });
  });

  it("passes a refusal on in the analyst's own words", async () => {
    happyPath();
    anthropic.mockReturnValue(fakeAnthropic(RESEARCH, "refusal").client);
    const events = await safeStream(await POST(post({ query: "garage workshop" })));
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "The analyst declined this request. Try again, or contact us if it repeats.",
    });
  });
});
