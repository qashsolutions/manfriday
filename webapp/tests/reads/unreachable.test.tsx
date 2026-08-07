/** One rule, proved on every surface that reads channel data: a read that
    FAILED must never render as an account that is EMPTY. Each page's view
    function gets the same three inputs — unreachable, genuinely empty, healthy
    — and has to keep them apart. The paired "empty" assertions are the other
    half of the guarantee: the guard must not change what a new creator sees.

    Effects can't run here (no jsdom, deps frozen), so the proof sits at each
    page's branch decision — the exported seam the JSX switches on — plus a
    render of the shared card. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChannelData, VideoPerf } from "@/lib/channelData";
import { ReadFailed, readFailed } from "@/components/ReadFailed";
import { deskView } from "@/app/(app)/desk/deskModel";
import { whyView } from "@/app/(app)/why/page";
import { packagingView } from "@/app/(app)/packaging/page";
import { scoutView } from "@/app/(app)/scout/page";

const CHANNEL = { id: "c1", title: "Bench Notes", handle: "@benchnotes", subscriber_count: 310 };

const BASE: ChannelData = {
  channel: null, baselines: {}, videos: [], flagsActive: false, lastUpdated: null, failed: false,
};

/** Supabase unreachable: no channel, no videos, and the marker set. */
const UNREACHABLE: ChannelData = { ...BASE, failed: true };
/** A real creator on day one: the reads worked, there is just nothing there. */
const EMPTY: ChannelData = BASE;
/** Connected, first analysis not run yet. */
const CONNECTED: ChannelData = { ...BASE, channel: CHANNEL };

const video: VideoPerf = {
  id: "v1", yt_video_id: "yt1", title: "A video", published_at: "2026-08-05T10:00:00Z",
  is_short: false, thumbnail_url: null, view_count: 96, views_per_day: 32, ratio: 0.2,
  flag: "underperformer", views_week_delta: null,
};
const READY: ChannelData = {
  ...BASE,
  channel: CHANNEL,
  baselines: { longform: { format: "longform", median_views: 480, mean_views: 500, sample_size: 12, computed_at: "x" } },
  videos: [video],
  flagsActive: true,
};

describe("the Desk", () => {
  it("separates unreachable from empty", () => {
    expect(deskView(UNREACHABLE)).toBe("unreachable");
    expect(deskView(EMPTY)).toBe("connect");
    expect(deskView(CONNECTED)).toBe("first-read");
    expect(deskView(READY)).toBe("ready");
  });

  it("keeps the marker ahead of a channel it already has in hand", () => {
    expect(deskView({ ...READY, failed: true })).toBe("unreachable");
  });
});

describe("/why — the video list", () => {
  it("separates unreachable from empty", () => {
    expect(whyView(UNREACHABLE)).toBe("unreachable");
    // byte-identical to today: no channel, or no comparable video, still invites
    expect(whyView(EMPTY)).toBe("empty");
    expect(whyView(CONNECTED)).toBe("empty");
    expect(whyView(READY)).toBe("ready");
  });

  it("would otherwise have said 'waiting on your first analysis' to a connected creator", () => {
    // the pre-guard condition, spelled out: on a failed read both halves of the
    // old test are false, which is exactly what the empty state used to key on
    const d = UNREACHABLE;
    expect(d.channel).toBeNull();
    expect(d.videos.some((v) => v.ratio !== null)).toBe(false);
    expect(whyView(d)).toBe("unreachable");
  });
});

describe("/why/[id] — one video's read", () => {
  it("separates unreachable from a video that genuinely isn't there", () => {
    expect(readFailed(UNREACHABLE)).toBe(true);
    expect(readFailed(READY)).toBe(false);
    expect(readFailed(EMPTY)).toBe(false);
    expect(readFailed(null)).toBe(false);
  });

  it("must guard before the not-found branch — a failed read has no videos to find", () => {
    expect(UNREACHABLE.videos.find((v) => v.id === "v1")).toBeUndefined();
    expect(READY.videos.find((v) => v.id === "v1")).toBeDefined();
  });
});

describe("/packaging — titles & thumbnails", () => {
  it("separates unreachable from a channel the team hasn't measured yet", () => {
    expect(packagingView({ failed: true, hasNumbers: false })).toBe("unreachable");
    expect(packagingView({ failed: true, hasNumbers: true })).toBe("unreachable");
    expect(packagingView({ failed: false, hasNumbers: false })).toBe("needs-first-read");
    expect(packagingView({ failed: false, hasNumbers: true })).toBe("ready");
  });
});

describe("/scout — the comparison desk", () => {
  it("separates unreachable from a page that simply has no data yet", () => {
    expect(scoutView(UNREACHABLE)).toBe("unreachable");
    expect(scoutView(EMPTY)).toBe("ready");   // unchanged: the page works while empty
    expect(scoutView(READY)).toBe("ready");
    expect(scoutView(null)).toBe("ready");    // unchanged: renders while loading
  });
});

describe("the shared card", () => {
  const html = renderToStaticMarkup(<ReadFailed onRetry={() => {}} />);
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

  it("says what happened and what to do, without apologising or blaming", () => {
    expect(text).toContain("Couldn't reach your numbers just now, so nothing here would be true.");
    expect(text).toContain("Nothing is lost — your channel and your Ledger are untouched.");
    expect(text).toContain("Try again");
  });

  it("offers the retry as a real button, not a dead line of text", () => {
    expect(html).toContain("<button");
    expect(html).toContain("btn-acc");
  });

  it("never invites a connect — that is the bug it exists to prevent", () => {
    expect(text.toLowerCase()).not.toContain("connect");
  });
});
