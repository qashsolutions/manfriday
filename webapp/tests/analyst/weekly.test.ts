import { beforeEach, describe, expect, it, vi } from "vitest";
import { doneOf, errorOf, fakeSvc, post, proseOf, safeJson, safeStream, stagesOf, TEST_USER } from "../helpers";

vi.mock("@/lib/server/auth", () => ({ userFromRequest: vi.fn() }));
vi.mock("@/lib/server/service", () => ({ serviceClient: vi.fn() }));
vi.mock("@/lib/server/weeklyReport", () => ({ writeWeeklyReport: vi.fn() }));

import { POST } from "@/app/api/analyst/weekly/route";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { writeWeeklyReport } from "@/lib/server/weeklyReport";

const auth = vi.mocked(userFromRequest);
const service = vi.mocked(serviceClient);
const weekly = vi.mocked(writeWeeklyReport);

beforeEach(() => {
  vi.clearAllMocks();
  service.mockReturnValue(fakeSvc().svc);
  auth.mockResolvedValue(TEST_USER);
});

describe("POST /api/analyst/weekly", () => {
  it("rejects unauthenticated requests", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("returns the report on the happy path", async () => {
    const report = { id: "r1", title: "Week of Aug 3", body_md: "## Your numbers", created_at: "2026-08-05T00:00:00Z" };
    weekly.mockResolvedValue(report);
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(doneOf(await safeStream(res)).report).toEqual(report);
  });

  it("hands the report over as it is written", async () => {
    const report = { id: "r1", title: "Week of Aug 3", body_md: "IGNORED", created_at: "2026-08-05T00:00:00Z" };
    const written = "**In short** — Views held steady; one tip is waiting on you.\n\n## Your numbers";
    weekly.mockImplementation(async (_svc, _userId, onProse) => {
      // Chunked the way the wire delivers it.
      for (let i = 0; i < written.length; i += 9) onProse?.(written.slice(i, i + 9));
      return report;
    });

    const events = await safeStream(await POST(post()));
    expect(proseOf(events)).toBe(written);
    expect(stagesOf(events)).toEqual(["The team is pulling your week together…"]);
    expect(events.findIndex((e) => e.t === "prose")).toBeLessThan(events.findIndex((e) => e.t === "done"));
  });

  it("is the caller that asks for the report as it is written", async () => {
    // The route passes a callback; the Monday cron does not. That the
    // no-callback path still behaves as it always did is proven against the
    // real module in tests/weeklyReport.test.ts.
    const report = { id: "r1", title: "Week of Aug 3", body_md: "## Your numbers", created_at: "2026-08-05T00:00:00Z" };
    weekly.mockResolvedValue(report);
    await safeStream(await POST(post()));

    expect(weekly).toHaveBeenCalledTimes(1);
    const [svcArg, userIdArg, onProseArg] = weekly.mock.calls[0];
    expect(svcArg).toBeDefined();
    expect(userIdArg).toBe(TEST_USER.id);
    expect(typeof onProseArg).toBe("function");
  });

  it("asks for a channel when there is nothing to report on", async () => {
    weekly.mockResolvedValue(null);
    const res = await POST(post());
    expect(res.status).toBe(200);
    const events = await safeStream(res);
    expect(errorOf(events)).toEqual({
      t: "error",
      error: "Connect your channel and run the first analysis first.",
    });
    expect(doneOf(events)).toBeUndefined();
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    weekly.mockRejectedValue(new Error("The analyst service hiccuped."));
    const events = await safeStream(await POST(post()));
    expect(errorOf(events)).toEqual({ t: "error", error: "The analyst service hiccuped." });
  });

  it("hides non-Error throws behind the generic message", async () => {
    weekly.mockRejectedValue("raw internal detail that must not surface");
    const events = await safeStream(await POST(post()));
    expect(errorOf(events)).toEqual({ t: "error", error: "The read couldn't finish." });
  });
});
