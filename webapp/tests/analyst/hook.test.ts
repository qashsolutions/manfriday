import { beforeEach, describe, expect, it, vi } from "vitest";
import { doneOf, errorOf, fakeAnthropic, fakeSvc, post, proseOf, safeJson, safeStream, stagesOf, TEST_USER } from "../helpers";
import { GHOSTWRITE_LINE } from "@/lib/hook";

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
// Only the network read is faked. The exit arithmetic — which seconds count as
// the moment viewers left, and how they become "0:22" — is the real one,
// because that arithmetic IS the read.
vi.mock("@/lib/server/retentionData", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRetention: vi.fn(),
}));

import { POST } from "@/app/api/analyst/hook/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { fetchRetention } from "@/lib/server/retentionData";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const accessToken = vi.mocked(accessTokenFromRow);
const retention = vi.mocked(fetchRetention);

const ANALYSIS = {
  in_short:
    "**In short** — 29 of every 100 viewers who got that far left at 0:22 on your last video, right as " +
    "the intro ran long, so all three openings below are at the point before that second arrives.",
  where_they_left:
    "Your viewers go in two waves: 12 of every 100 are gone by 0:07, and another 29 leave at 0:22 — both " +
    "before the video has shown them anything.",
  voice_note: null,
  rewrites: [
    {
      shape: "cold open",
      effort: "minimal edit",
      choice: "Cold open — start on the finished shelf, no greeting.",
      opening: "This shelf holds two hundred kilos and cost me forty quid. Here's the join that does it.",
      why: "29 of every 100 left at 0:22 last time, right as the intro ran long — this one is inside the build before that second arrives.",
      confidence: 45,
      evidence: [{ kind: "library", label: "your own drop at 0:22" }],
    },
    {
      shape: "question",
      effort: "minimal edit",
      choice: "Question — open on what they came to find out.",
      opening: "Why does every cheap shelf sag in the middle? It's one cut, and you can fix it in ten minutes.",
      why: "12 of every 100 were gone by 0:07 before you'd asked them anything — this names their problem in the first breath.",
      confidence: 40,
      evidence: [{ kind: "library", label: "gone by 0:07" }],
    },
  ],
};

const REPORT_ROW = { id: "r1", title: 'A stronger opening for "My workshop video"', created_at: "2026-08-07T00:00:00Z" };

const V1 = { id: "dbv1", yt_video_id: "vidAAAAAAA1", title: "My workshop video", duration_seconds: 220, is_short: false };
const V2 = { id: "dbv2", yt_video_id: "vidAAAAAAA2", title: "The shelf build", duration_seconds: 300, is_short: false };
const V3 = { id: "dbv3", yt_video_id: "vidAAAAAAA3", title: "A quiet one", duration_seconds: 180, is_short: false };

/** 220 seconds long, so a curve step of 0.01 is 2.2 seconds and 0.10 is 0:22.
    Two real losses in the first minute: a small one at 0:07 and the big one at
    0:22 — exactly the shape this surface exists for. */
const CURVE_1 = {
  points: [
    { x: 0.0, watch: 1.0, rel: null },
    { x: 0.03, watch: 0.88, rel: null },
    { x: 0.06, watch: 0.84, rel: null },
    { x: 0.1, watch: 0.55, rel: null },
    { x: 0.14, watch: 0.52, rel: null },
    { x: 0.18, watch: 0.5, rel: null },
    { x: 0.22, watch: 0.48, rel: null },
    { x: 0.27, watch: 0.46, rel: null },
    { x: 0.3, watch: 0.44, rel: null },
    { x: 0.5, watch: 0.4, rel: null },
    { x: 1.0, watch: 0.2, rel: null },
  ],
  drops: [],
};

/** 300 seconds, and it holds much better through the half-minute mark. */
const CURVE_2 = {
  points: [
    { x: 0.0, watch: 1.0, rel: null },
    { x: 0.05, watch: 0.9, rel: null },
    { x: 0.1, watch: 0.61, rel: null },
    { x: 0.2, watch: 0.58, rel: null },
    { x: 1.0, watch: 0.3, rel: null },
  ],
  drops: [],
};

const DRAFT = "Hey guys, welcome back to the channel, today we're going to be looking at storage.";

function tables(opts: {
  target?: Record<string, unknown> | null;
  recent?: Record<string, unknown>[];
  snapshots?: { video_id: string; view_count: number | null; captured_at: string }[];
} = {}) {
  const videos: { data: unknown }[] = [];
  if (opts.target !== undefined) videos.push({ data: opts.target });
  videos.push({ data: opts.recent ?? [V1, V2, V3] });
  return {
    google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
    channels: [{ data: [{ id: "ch1", title: "My Channel", subscriber_count: 420 }] }],
    videos,
    video_snapshots: [{
      data: opts.snapshots ?? [
        { video_id: "dbv1", view_count: 1340, captured_at: "2026-08-06T00:00:00Z" },
        { video_id: "dbv1", view_count: 900, captured_at: "2026-08-01T00:00:00Z" },
        { video_id: "dbv2", view_count: 900, captured_at: "2026-08-06T00:00:00Z" },
        { video_id: "dbv3", view_count: 12, captured_at: "2026-08-06T00:00:00Z" },
      ],
    }],
    reports: [{ data: REPORT_ROW, error: null }],
  };
}

let fake: ReturnType<typeof fakeAnthropic>;

function happyMocks() {
  accessToken.mockResolvedValue("access-token");
  retention.mockImplementation(async (_t: string, id: string) =>
    (id === "vidAAAAAAA1" ? CURVE_1 : id === "vidAAAAAAA2" ? CURVE_2 : null) as never
  );
  fake = fakeAnthropic(ANALYSIS);
  anthropic.mockReturnValue(fake.client);
}

const material = () => String((fake.stream.mock.calls[0][0] as any).messages[0].content);

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/hook — the guards", () => {
  it("rejects unauthenticated requests", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post({ draft: DRAFT }));
    expect(res.status).toBe(401);
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("asks for one of the two inputs when given neither", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect((await safeJson(res)).error).toContain("Paste the opening you've drafted, or pick one of your videos");
  });

  it("answers a whole-script ask with one honest line — and never pays for a read", async () => {
    happyMocks();
    service.mockReturnValue(fakeSvc(tables()).svc);
    const res = await POST(post({ draft: `${DRAFT} ${"word ".repeat(200)}` }));
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(body.error).toBe(GHOSTWRITE_LINE);
    expect(body.error).toContain("the rest of the script stays yours to write");
    expect(body.limit).toBe(120);
    // the refusal is arithmetic, so nothing was generated to say it
    expect(fake.stream).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("says to connect a channel when there isn't one", async () => {
    service.mockReturnValue(fakeSvc({
      google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
      channels: [{ data: [] }],
    }).svc);
    const res = await POST(post({ draft: DRAFT }));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Connect your channel first." });
  });

  it("rejects a video that isn't in the analysis yet", async () => {
    service.mockReturnValue(fakeSvc({
      google_oauth_tokens: [{ data: { refresh_token_ciphertext: "\\xdeadbeef" } }],
      channels: [{ data: [{ id: "ch1", title: "My Channel", subscriber_count: 420 }] }],
      videos: [{ data: null }],
    }).svc);
    const res = await POST(post({ video: "vidZZZZZZZ9" }));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({
      error: "This video isn't in your analysis yet — run the first analysis on the Desk.",
    });
  });
});

describe("POST /api/analyst/hook — grounded in their own seconds", () => {
  it("turns their real curves into the seconds viewers left, and saves the read", async () => {
    const { svc, inserts } = fakeSvc(tables());
    service.mockReturnValue(svc);
    happyMocks();

    const res = await POST(post({ draft: DRAFT }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const done = doneOf(await safeStream(res));
    expect(done.grounded).toBe(true);
    expect(done.analysis).toEqual(ANALYSIS);
    expect(done.report).toEqual(REPORT_ROW);
    expect(done.videosRead).toBe(2);
    expect(done.checkBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // the two steepest losses per video, inside the first minute, in video order
    expect(done.exits.map((e: { label: string }) => e.label)).toEqual(["0:07", "0:22", "0:15", "0:30"]);
    expect(done.exits[1]).toEqual({
      videoTitle: "My workshop video", label: "0:22", atSeconds: 22, lostPer100: 29, stillPer100: 55,
    });
    // the best-held opening first — the one worth copying
    expect(done.held[0]).toEqual({ videoTitle: "The shelf build", label: "0:30", heldPer100: 61 });
    // the video with 12 views never had its curve pulled
    expect(retention).toHaveBeenCalledTimes(2);
    expect(done.belowFloor).toBe(1);

    const stored = (inserts.reports?.[0] ?? {}) as Record<string, any>;
    expect(stored.agent).toBe("the Editor");
    expect(stored.data.kind).toBe("hook");
    expect(stored.data.grounded).toBe(true);
    expect(stored.title).toBe("A stronger opening for your draft");
  });

  it("hands the Editor only seconds that are real, and the openings that held", async () => {
    service.mockReturnValue(fakeSvc(tables()).svc);
    happyMocks();
    await safeStream(await POST(post({ draft: DRAFT })));

    const m = material();
    expect(m).toContain("29 of every 100 who got that far left at 0:22");
    expect(m).toContain("leaving 55 of every 100 still watching");
    expect(m).toContain('"The shelf build": 61 of every 100 still watching at 0:30');
    expect(m).toContain(DRAFT);
    // the three shapes, defined the same way for the model and the creator
    expect(m).toContain('"cold open"');
    expect(m).toContain('"question"');
    expect(m).toContain('"result-first"');
    // and the ceiling on what it may write
    expect((fake.stream.mock.calls[0][0] as any).system).toContain("Openings only");
    expect((fake.stream.mock.calls[0][0] as any).system).toContain("never write the rest of the video");
  });

  it("re-hooks a video the creator picked, using what that video actually says", async () => {
    service.mockReturnValue(fakeSvc(tables({ target: V1 })).svc);
    happyMocks();

    const done = doneOf(await safeStream(await POST(post({
      video: "vidAAAAAAA1",
      spoken: "Hey everyone, welcome back, before we start please hit subscribe, so anyway today...",
    }))));
    expect(done.target).toEqual({ ytVideoId: "vidAAAAAAA1", title: "My workshop video" });

    const m = material();
    expect(m).toContain("WHAT THIS VIDEO ACTUALLY SAYS AT THE START");
    expect(m).toContain("quote it when you explain an exit");
    expect(m).toContain("please hit subscribe");
    expect(m).not.toContain("NO SAMPLE OF HOW THEY ACTUALLY SPEAK");
  });

  it("uses a best-held opening as the voice sample when the creator pastes one", async () => {
    service.mockReturnValue(fakeSvc(tables()).svc);
    happyMocks();
    await safeStream(await POST(post({
      draft: DRAFT,
      spoken: "Two hundred kilos. That's what this thing holds, and I built it out of scrap.",
      spokenFrom: "The shelf build",
    })));

    const m = material();
    expect(m).toContain('HOW THEY OPENED "The shelf build"');
    expect(m).toContain("match its rhythm and vocabulary");
    expect(m).toContain("Two hundred kilos.");
    expect(m).not.toContain("NO SAMPLE OF HOW THEY ACTUALLY SPEAK");
  });

  it("says plainly when it has no sample of how they speak — and never claims otherwise", async () => {
    service.mockReturnValue(fakeSvc(tables()).svc);
    happyMocks();
    await safeStream(await POST(post({ draft: DRAFT })));

    const m = material();
    expect(m).toContain("NO SAMPLE OF HOW THEY ACTUALLY SPEAK");
    expect(m).toContain("Match the draft's register");
    expect(m).toContain("never claim to be imitating their voice");
    expect((fake.stream.mock.calls[0][0] as any).system).toContain("never claim");
  });

  it("hands over the openings as they are written, before the read lands", async () => {
    service.mockReturnValue(fakeSvc(tables()).svc);
    happyMocks();

    const events = await safeStream(await POST(post({ draft: DRAFT })));
    expect(proseOf(events)).toBe(ANALYSIS.in_short);
    expect(proseOf(events)).toContain("**In short** —");
    expect(stagesOf(events)[0]).toBe("The Editor is pulling up where viewers left your last few videos…");
    expect(stagesOf(events)[1]).toContain("Reading the first minute of 2 of your videos");
    expect(events.findIndex((e) => e.t === "prose")).toBeLessThan(events.findIndex((e) => e.t === "done"));
  });
});

describe("POST /api/analyst/hook — below the floor", () => {
  const QUIET = [
    { video_id: "dbv1", view_count: 15, captured_at: "2026-08-06T00:00:00Z" },
    { video_id: "dbv2", view_count: 4, captured_at: "2026-08-06T00:00:00Z" },
    { video_id: "dbv3", view_count: 0, captured_at: "2026-08-06T00:00:00Z" },
  ];
  const CRAFT = {
    ...ANALYSIS,
    in_short:
      "**In short** — none of your videos has enough viewers yet for YouTube to show where people left, so " +
      "these three openings are built on craft rather than on your numbers.",
    where_they_left: null,
    voice_note: "These match the words you pasted rather than your speaking voice.",
  };

  function craftMocks() {
    accessToken.mockResolvedValue("access-token");
    retention.mockResolvedValue(null);
    fake = fakeAnthropic(CRAFT);
    anthropic.mockReturnValue(fake.client);
  }

  it("still writes the creator their openings — the floor changes the grounding, not the help", async () => {
    service.mockReturnValue(fakeSvc(tables({ snapshots: QUIET })).svc);
    craftMocks();

    const done = doneOf(await safeStream(await POST(post({ draft: DRAFT }))));
    expect(done.grounded).toBe(false);
    expect(done.exits).toEqual([]);
    expect(done.held).toEqual([]);
    expect(done.videosRead).toBe(0);
    expect(done.viewsFloor).toBe(50);
    // the difference from the distribution read, stated as a test: the model runs
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(done.analysis.rewrites).toHaveLength(2);
    // …and not one Analytics call was paid for to find out the numbers are thin
    expect(retention).not.toHaveBeenCalled();
  });

  it("forbids the grounding it doesn't have, in as many words", async () => {
    service.mockReturnValue(fakeSvc(tables({ snapshots: QUIET })).svc);
    craftMocks();
    await safeStream(await POST(post({ draft: DRAFT })));

    const m = material();
    expect(m).toContain("NO USABLE EXIT SECONDS — WRITE ON CRAFT, AND SAY SO");
    expect(m).toContain("where_they_left MUST be null");
    expect(m).toContain("Do NOT state or imply any second");
    expect(m).toContain("about 50 viewers");
    // nothing that looks like a real exit second is anywhere in the material
    expect(m).not.toMatch(/left at \d+:\d\d/);
    expect(m).not.toContain("WHERE VIEWERS LEFT IN THE FIRST MINUTE");
  });

  it("says so in the narration too, rather than going quiet", async () => {
    service.mockReturnValue(fakeSvc(tables({ snapshots: QUIET })).svc);
    craftMocks();
    const stages = stagesOf(await safeStream(await POST(post({ draft: DRAFT }))));
    expect(stages[1]).toBe("Not enough viewers yet to see where people left — writing on craft, and saying so…");
  });
});

describe("POST /api/analyst/hook — the shape of the answer", () => {
  it("asks for 2-3 typed openings the Ledger can file", async () => {
    service.mockReturnValue(fakeSvc(tables()).svc);
    happyMocks();
    await safeStream(await POST(post({ draft: DRAFT })));

    const schema = (fake.stream.mock.calls[0][0] as any).output_config.format.schema;
    const rewrites = schema.properties.rewrites;
    expect(rewrites.description).toMatch(/2 or 3/);
    expect(rewrites.items.properties.shape.enum).toEqual(["cold open", "question", "result-first"]);
    // DESIGN.md §8's effort vocabulary, not a per-route invention
    expect(rewrites.items.properties.effort.enum).toEqual([
      "minimal edit", "re-cut", "format change", "next upload", "new video",
    ]);
    expect(rewrites.items.required).toEqual(
      expect.arrayContaining(["shape", "effort", "choice", "opening", "why", "confidence", "evidence"])
    );
    // the honest thin state has a place to live in the answer itself
    expect(schema.properties.where_they_left.anyOf).toContainEqual({ type: "null" });
    expect(schema.properties.where_they_left.description).toContain("MUST be null");
    // and the opening can't quietly become a script
    expect(rewrites.items.properties.opening.description).toContain("30 seconds spoken");
  });

  it("never lets jargon or a raw number reach the reader", async () => {
    service.mockReturnValue(fakeSvc(tables()).svc);
    happyMocks();
    const wire = JSON.stringify(await safeStream(await POST(post({ draft: DRAFT }))));
    for (const banned of ["median", "baseline", "retention", "audienceWatchRatio", "elapsedVideoTimeRatio", "CTR", "impressions"]) {
      expect(wire.toLowerCase(), `the wire leaked ${banned}`).not.toContain(banned.toLowerCase());
    }
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    service.mockReturnValue(fakeSvc(tables()).svc);
    happyMocks();
    accessToken.mockRejectedValue(new Error("Couldn't refresh YouTube access — reconnect the channel in Settings."));

    const events = await safeStream(await POST(post({ draft: DRAFT })));
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "Couldn't refresh YouTube access — reconnect the channel in Settings.",
    });
  });
});
