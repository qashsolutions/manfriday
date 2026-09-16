import { describe, expect, test } from "vitest";
import { STATUS_LABEL, destination } from "../../lib/queue-copy";

const at = Date.UTC(2026, 8, 20, 17, 30);

describe("queue copy", () => {
  test("a TikTok post never claims to be published — it names the inbox and the tap", () => {
    const d = destination({ platform: "tiktok", status: "draft_fallback", publishAt: at, deferred: false })!;
    expect(d).toMatch(/TikTok app/);
    expect(d).toMatch(/Inbox/);
    expect(d).not.toMatch(/live|published/i);
    // The chip agrees with the sentence.
    expect(STATUS_LABEL.draft_fallback).toBe("DRAFT IN TIKTOK");
    expect(STATUS_LABEL.draft_fallback).not.toMatch(/SCHEDULED|LIVE/);
  });

  test("a queued TikTok post warns the tap is coming, before the user waits for a profile post", () => {
    const d = destination({ platform: "tiktok", status: "queued", publishAt: at, deferred: false })!;
    expect(d).toMatch(/inbox/i);
    expect(d).toMatch(/tap post/i);
  });

  test("a queued YouTube post says Friday does it, with the time", () => {
    const d = destination({ platform: "youtube", status: "queued", publishAt: at, deferred: false })!;
    expect(d).toMatch(/uploads this to YouTube/);
    expect(d).toContain(new Date(at).toLocaleString());
  });

  test("a quota-deferred post explains the move and that nothing is required", () => {
    const d = destination({ platform: "youtube", status: "queued", publishAt: at, deferred: true })!;
    expect(d).toMatch(/upload limit/);
    expect(d).toMatch(/Nothing to do/);
  });

  test("a live YouTube post sets the once-a-day expectation", () => {
    expect(destination({ platform: "youtube", status: "live", publishAt: at, deferred: false })).toMatch(/every morning/);
  });

  test("a failed attempt has no destination line — the error line speaks instead", () => {
    expect(destination({ platform: "youtube", status: "failed", publishAt: at, deferred: false })).toBeNull();
    expect(destination({ platform: "tiktok", status: "failed", publishAt: at, deferred: false })).toBeNull();
  });
});
