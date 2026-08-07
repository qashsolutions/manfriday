import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAnthropic, fakeSvc, TEST_USER } from "./helpers";

vi.mock("@/lib/server/anthropicClient", () => ({ anthropicClient: vi.fn() }));

import { writeWeeklyReport } from "@/lib/server/weeklyReport";
import { anthropicClient } from "@/lib/server/anthropicClient";

const anthropic = vi.mocked(anthropicClient);

const WEEKLY = {
  title: "Week of Aug 3 — steady, one decision",
  body_md:
    "**In short** — Views held steady and one tip is waiting on you.\n\n" +
    "## Your numbers\n- 15 views tracked\n\n## What your team did\n- read your comments\n\n" +
    "## Needs you (one decision)\n- apply the retitle, or skip it and say why",
};

const REPORT_ROW = { id: "r1", title: WEEKLY.title, body_md: WEEKLY.body_md, created_at: "2026-08-05T00:00:00Z" };

function happyTables() {
  return {
    channels: [{ data: [{ id: "ch1", title: "My Channel", handle: "@mine", subscriber_count: 42 }] }],
    videos: [{ data: [{ id: "v1", yt_video_id: "vidAAAAAAA1", title: "Video one", published_at: "2026-08-01T00:00:00Z", is_short: false }] }],
    video_snapshots: [{ data: [{ video_id: "v1", view_count: 15, views_per_day: 2, captured_at: "2026-08-04T00:00:00Z" }] }],
    channel_baselines: [{ data: [{ format: "longform", median_views: 120, sample_size: 8, computed_at: "2026-08-01T00:00:00Z" }] }],
    recommendations: [{ data: [] }, { data: [] }],
    reports: [{ data: REPORT_ROW, error: null }],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("writeWeeklyReport", () => {
  it("takes the whole report in one piece when nobody is watching", async () => {
    // This is the Monday cron's call: two arguments, no callback.
    const fake = fakeAnthropic(WEEKLY);
    anthropic.mockReturnValue(fake.client);

    const report = await writeWeeklyReport(fakeSvc(happyTables()).svc, TEST_USER.id);

    expect(report).toEqual(REPORT_ROW);
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.stream).not.toHaveBeenCalled();
  });

  it("hands the report over as it is written when a caller asks", async () => {
    const fake = fakeAnthropic(WEEKLY);
    anthropic.mockReturnValue(fake.client);

    let streamed = "";
    const report = await writeWeeklyReport(fakeSvc(happyTables()).svc, TEST_USER.id, (d) => { streamed += d; });

    expect(report).toEqual(REPORT_ROW);
    expect(streamed).toBe(WEEKLY.body_md);
    expect(streamed.startsWith("**In short** —")).toBe(true);
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("writes the same report either way", async () => {
    anthropic.mockReturnValue(fakeAnthropic(WEEKLY).client);
    const whole = await writeWeeklyReport(fakeSvc(happyTables()).svc, TEST_USER.id);

    anthropic.mockReturnValue(fakeAnthropic(WEEKLY).client);
    const streamed = await writeWeeklyReport(fakeSvc(happyTables()).svc, TEST_USER.id, () => {});

    expect(streamed).toEqual(whole);
  });

  it("returns null when the user has no owned channel — on both paths", async () => {
    anthropic.mockReturnValue(fakeAnthropic(WEEKLY).client);
    expect(await writeWeeklyReport(fakeSvc({ channels: [{ data: [] }] }).svc, TEST_USER.id)).toBeNull();
    expect(await writeWeeklyReport(fakeSvc({ channels: [{ data: [] }] }).svc, TEST_USER.id, () => {})).toBeNull();
  });
});
