/** A read that failed is not an account that's empty. Before this, an
    unreachable Supabase and a brand-new creator produced byte-identical data,
    so the Desk told connected creators to connect their channel. These tests
    hold the two apart — at the loader, and at the screen it decides. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  authUser: { id: string } | null;
  authError: { message: string } | null;
  results: Record<string, { data?: unknown; error?: { message: string } | null }>;
} = { authUser: { id: "u1" }, authError: null, results: {} };

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: state.authError }),
    },
    from(table: string) {
      const result = { data: null, error: null, ...(state.results[table] ?? {}) };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "order", "limit", "maybeSingle", "single"]) {
        chain[m] = () => chain;
      }
      chain.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, err);
      return chain;
    },
  }),
}));

import { loadChannelData } from "@/lib/channelData";
import { deskView } from "@/app/(app)/desk/deskModel";

const CHANNEL = { id: "c1", title: "Bench Notes", handle: "@benchnotes", subscriber_count: 310 };
const NETWORK = { message: "TypeError: Failed to fetch" };

beforeEach(() => {
  state.authUser = { id: "u1" };
  state.authError = null;
  state.results = {};
});

describe("loadChannelData tells a failed read from an empty account", () => {
  it("marks the read failed when Supabase can't be reached at all", async () => {
    state.authUser = null;
    state.authError = NETWORK;
    const d = await loadChannelData();
    expect(d.failed).toBe(true);
    expect(d.channel).toBeNull();
  });

  it("marks the read failed when the channels query errors", async () => {
    state.results = { channels: { error: NETWORK } };
    const d = await loadChannelData();
    expect(d.failed).toBe(true);
  });

  it("marks the read failed when only the numbers behind the channel fail", async () => {
    state.results = {
      channels: { data: [CHANNEL] },
      channel_baselines: { data: [] },
      videos: { error: NETWORK },
      video_snapshots: { data: [] },
    };
    const d = await loadChannelData();
    expect(d.failed).toBe(true);
    expect(d.channel).toEqual(CHANNEL); // what we did read is still true
  });

  it("does NOT mark a signed-out visitor as a failure", async () => {
    state.authUser = null;
    const d = await loadChannelData();
    expect(d.failed).toBe(false);
    expect(d.channel).toBeNull();
  });

  it("does NOT mark a creator with no channel yet as a failure", async () => {
    state.results = { channels: { data: [] } };
    const d = await loadChannelData();
    expect(d.failed).toBe(false);
    expect(d.channel).toBeNull();
  });

  it("reads a healthy channel with failed false", async () => {
    state.results = {
      channels: { data: [CHANNEL] },
      channel_baselines: { data: [{ format: "longform", median_views: 480, mean_views: 500, sample_size: 12, computed_at: "2026-08-06" }] },
      videos: { data: [{ id: "v1", yt_video_id: "yt1", title: "A video", published_at: "2026-08-05", is_short: false, thumbnail_url: null }] },
      video_snapshots: { data: [{ video_id: "v1", view_count: 96, views_per_day: 32, captured_at: "2026-08-07T06:00:00Z" }] },
    };
    const d = await loadChannelData();
    expect(d.failed).toBe(false);
    expect(d.channel).toEqual(CHANNEL);
    expect(d.videos[0].view_count).toBe(96);
  });
});

describe("the Desk never mistakes an unreachable read for a new account", () => {
  const base = { channel: null, baselines: {}, videos: [], flagsActive: false, lastUpdated: null, failed: false };

  it("shows the unreachable screen, not the connect invitation, on a failed read", async () => {
    state.authUser = null;
    state.authError = NETWORK;
    expect(deskView(await loadChannelData())).toBe("unreachable");
  });

  it("still invites a genuinely new account to connect", () => {
    expect(deskView(base)).toBe("connect");
  });

  it("asks a connected channel with no numbers yet for its first read", () => {
    expect(deskView({ ...base, channel: CHANNEL })).toBe("first-read");
  });

  it("answers the three questions once there are numbers", () => {
    expect(deskView({
      ...base,
      channel: CHANNEL,
      baselines: { longform: { format: "longform", median_views: 480, mean_views: 500, sample_size: 12, computed_at: "x" } },
    })).toBe("ready");
  });

  it("a failed read outranks every other state — even with a channel in hand", () => {
    expect(deskView({ ...base, channel: CHANNEL, failed: true })).toBe("unreachable");
  });
});
