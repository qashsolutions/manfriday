import { beforeEach, describe, expect, it, vi } from "vitest";
import { doneOf, errorOf, fakeAnthropic, fakeSvc, post, proseOf, safeJson, safeStream, stagesOf, TEST_USER } from "../helpers";

vi.mock("@/lib/server/auth", () => ({ userFromRequest: vi.fn() }));
vi.mock("@/lib/server/service", () => ({ serviceClient: vi.fn() }));
vi.mock("@/lib/server/anthropicClient", () => ({ anthropicClient: vi.fn() }));
vi.mock("@/lib/server/grounding", () => ({
  analystGrounding: vi.fn(async () => ({ audienceBlock: "AUDIENCE", trackBlock: "TRACK" })),
}));
vi.mock("@/lib/server/publicYt", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  typedPhrases: vi.fn(),
}));

import { POST } from "@/app/api/analyst/packaging/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { anthropicClient } from "@/lib/server/anthropicClient";
import { typedPhrases } from "@/lib/server/publicYt";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const anthropic = vi.mocked(anthropicClient);
const phrases = vi.mocked(typedPhrases);

const GRADE = {
  grade: "B+",
  one_line: "A clear promise, but their winners name the payoff in the first three words.",
  strengths: ["Concrete subject"],
  risks: ["The payoff arrives too late in the line"],
  options: [
    { type: "safe", title: "Sharpen a chisel like their winners", why: "Matches their proven pattern.", confidence: 45, evidence: [{ kind: "library", label: "pattern in their winners" }], audience_fit: null },
    { type: "reach", title: "How to sharpen a chisel by hand", why: "Matches what people type.", confidence: 40, evidence: [{ kind: "search", label: "people type this" }], audience_fit: null },
    { type: "bold", title: "The chisel mistake dulling your work", why: "Untested angle here.", confidence: 35, evidence: [{ kind: "caution", label: "untested on this channel" }], audience_fit: null },
  ],
  search_note: null,
  thin_data_note: null,
  thumb_read: null,
};

const BASELINE_ROW = {
  format: "longform",
  median_views: 120,
  sample_size: 8,
  computed_at: "2026-08-01T00:00:00Z",
  videos: [
    { title: "Winner video", view_count: 500, ratio_to_median: 4.2, flag: "outperformer" },
    { title: "Miss video", view_count: 30, ratio_to_median: 0.2, flag: "underperformer" },
    { title: "Typical video", view_count: 110, ratio_to_median: 1.0, flag: "typical" },
  ],
};

function happyTables() {
  return {
    channels: [{ data: [{ id: "ch1", title: "My Channel", handle: "@me" }] }],
    channel_baselines: [{ data: [BASELINE_ROW] }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/packaging", () => {
  it("rejects unauthenticated requests", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post({ title: "Anything" }));
    expect(res.status).toBe(401);
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("rejects an empty draft title", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Type a draft title first." });
  });

  it("requires a baseline before grading", async () => {
    service.mockReturnValue(fakeSvc({
      channels: [{ data: [{ id: "ch1", title: "My Channel", handle: "@me" }] }],
      channel_baselines: [{ data: [] }],
    }).svc);
    phrases.mockResolvedValue([]);
    const res = await POST(post({ title: "How to sharpen a chisel" }));
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Run the first analysis on the Desk first — grading needs your baseline." });
  });

  it("grades the draft against the creator's own track record", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    phrases.mockResolvedValue(["how to sharpen a chisel"]);
    const fake = fakeAnthropic(GRADE);
    anthropic.mockReturnValue(fake.client);

    const res = await POST(post({ title: "How to sharpen a chisel" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const done = doneOf(await safeStream(res));
    expect(done.analysis).toEqual(GRADE);
    expect(done.phrases).toEqual(["how to sharpen a chisel"]);
    expect(fake.stream).toHaveBeenCalledTimes(1);
  });

  it("streams the grade's reason — the top-level one, not the thumbnail's", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    phrases.mockResolvedValue(["how to sharpen a chisel"]);
    // This shape carries `one_line` twice: at the root, and again nested inside
    // `thumb_read`. Only the root one is the grade's reason.
    const graded = { ...GRADE, thumb_read: { one_line: "The thumbnail's own read.", works: [], risks: [] } };
    anthropic.mockReturnValue(fakeAnthropic(graded).client);

    const events = await safeStream(await POST(post({ title: "How to sharpen a chisel" })));
    expect(proseOf(events)).toBe(GRADE.one_line);
    expect(proseOf(events)).not.toContain("thumbnail's own read");
    expect(stagesOf(events)[0]).toBe("The Marketer is lining your draft up against your own winners…");
    expect(stagesOf(events).at(-1)).toBe("The Marketer is grading it…");
  });

  it("puts the grade on the record, with the normal it was graded against", async () => {
    const fake = fakeSvc({ ...happyTables(), reports: [{ data: { id: "rep1", title: "t", created_at: "2026-08-07T00:00:00Z" } }] });
    service.mockReturnValue(fake.svc);
    phrases.mockResolvedValue([]);
    anthropic.mockReturnValue(fakeAnthropic(GRADE).client);

    const done = doneOf(await safeStream(await POST(post({ title: "How to sharpen a chisel" }))));
    expect(done.report).toMatchObject({ id: "rep1" });

    const row = fake.inserts.reports[0] as any;
    expect(row).toMatchObject({ agent: "the Marketer", channel_id: "ch1" });
    expect(row.title).toBe('Title grade for "How to sharpen a chisel"');
    expect(row.body_md).toContain("Grade B+");
    expect(row.body_md).toContain('"Sharpen a chisel like their winners"');
    expect(row.data).toMatchObject({ kind: "packaging", draft: "How to sharpen a chisel", grade: "B+" });
    // The number the Scorekeeper will compare against later — stored at grade
    // time, because a later upload moves it.
    expect(row.data.normal).toEqual([{ format: "longform", usual_views: 120, sample_size: 8, swing: null }]);
  });

  it("turns a model refusal into the friendly analyst message", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    phrases.mockResolvedValue([]);
    anthropic.mockReturnValue(fakeAnthropic(null, "refusal").client);

    const events = await safeStream(await POST(post({ title: "How to sharpen a chisel" })));
    expect(errorOf(events)).toEqual({
      t: "error",
      kind: "failure",
      error: "The analyst declined this request. Try again, or contact us if it repeats.",
    });
  });

  it("surfaces an analyst-call failure as its message only — no stack, no keys", async () => {
    service.mockReturnValue(fakeSvc(happyTables()).svc);
    phrases.mockResolvedValue([]);
    const fake = fakeAnthropic(GRADE);
    fake.stream.mockImplementation(() => { throw new Error("Connection error."); });
    anthropic.mockReturnValue(fake.client);

    const events = await safeStream(await POST(post({ title: "How to sharpen a chisel" })));
    expect(errorOf(events)).toEqual({ t: "error", kind: "failure", error: "Connection error." });
  });
});
