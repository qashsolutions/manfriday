import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSvc, post, safeJson, TEST_USER } from "../helpers";

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
    expect(await safeJson(res)).toEqual({ report });
    expect(weekly).toHaveBeenCalledWith(expect.anything(), TEST_USER.id);
  });

  it("asks for a channel when there is nothing to report on", async () => {
    weekly.mockResolvedValue(null);
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect(await safeJson(res)).toEqual({ error: "Connect your channel and run the first analysis first." });
  });

  it("surfaces a thrown error as its message only — no stack, no keys", async () => {
    weekly.mockRejectedValue(new Error("The analyst service hiccuped."));
    const res = await POST(post());
    expect(res.status).toBe(502);
    expect(await safeJson(res)).toEqual({ error: "The analyst service hiccuped." });
  });

  it("hides non-Error throws behind the generic message", async () => {
    weekly.mockRejectedValue("raw internal detail that must not surface");
    const res = await POST(post());
    expect(res.status).toBe(502);
    expect(await safeJson(res)).toEqual({ error: "The weekly report couldn't finish." });
  });
});
