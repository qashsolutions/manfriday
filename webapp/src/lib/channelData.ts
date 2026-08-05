"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

export type Baseline = {
  format: "longform" | "shorts";
  median_views: number;
  mean_views: number;
  sample_size: number;
  computed_at: string;
};

export type VideoPerf = {
  id: string;
  yt_video_id: string;
  title: string | null;
  published_at: string | null;
  is_short: boolean | null;
  thumbnail_url: string | null;
  view_count: number | null;
  views_per_day: number | null;
  ratio: number | null;
  flag: "outperformer" | "underperformer" | "typical" | null;
  /** Views gained over the last ~7 days of snapshots; null until history exists. */
  views_week_delta: number | null;
};

export type ChannelData = {
  channel: { id: string; title: string | null; handle: string | null; subscriber_count: number | null } | null;
  baselines: Partial<Record<"longform" | "shorts", Baseline>>;
  videos: VideoPerf[];
  /** false = the channel's numbers are too small for ×-comparisons to mean anything yet */
  flagsActive: boolean;
  /** When the numbers were last pulled from YouTube (newest snapshot). */
  lastUpdated: string | null;
};

/** Flags only mean something once a format has a real sample and real views. */
const MIN_MEDIAN_FOR_FLAGS = 100;
const MIN_SAMPLE_FOR_FLAGS = 5;
function formatHasSignal(b: Baseline | undefined): boolean {
  return !!b && b.median_views >= MIN_MEDIAN_FOR_FLAGS && b.sample_size >= MIN_SAMPLE_FOR_FLAGS;
}

export async function loadChannelData(): Promise<ChannelData> {
  const supabase = supabaseBrowser();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { channel: null, baselines: {}, videos: [], flagsActive: false, lastUpdated: null };

  const { data: chans } = await supabase
    .from("channels")
    .select("id,title,handle,subscriber_count")
    .eq("is_owned", true)
    .limit(1);
  const channel = (chans?.[0] as ChannelData["channel"]) ?? null;
  if (!channel) return { channel: null, baselines: {}, videos: [], flagsActive: false, lastUpdated: null };

  const [{ data: bl }, { data: vids }, { data: snaps }] = await Promise.all([
    supabase
      .from("channel_baselines")
      .select("format,median_views,mean_views,sample_size,computed_at")
      .eq("channel_id", channel.id)
      .order("computed_at", { ascending: false })
      .limit(10),
    supabase
      .from("videos")
      .select("id,yt_video_id,title,published_at,is_short,thumbnail_url")
      .eq("channel_id", channel.id)
      .order("published_at", { ascending: false })
      .limit(30),
    supabase
      .from("video_snapshots")
      .select("video_id,view_count,views_per_day,captured_at")
      .order("captured_at", { ascending: false })
      .limit(200),
  ]);

  const baselines: ChannelData["baselines"] = {};
  for (const b of (bl ?? []) as Baseline[]) {
    if (!baselines[b.format]) baselines[b.format] = b;
  }

  const lastUpdated = ((snaps ?? []) as { captured_at: string }[])[0]?.captured_at ?? null;
  const latestSnap = new Map<string, { view_count: number | null; views_per_day: number | null }>();
  // Oldest snapshot within the last 7 days, per video — for "what moved this week".
  const weekAgo = Date.now() - 7 * 86_400_000;
  const oldestRecent = new Map<string, { view_count: number | null; captured_at: string }>();
  for (const s of (snaps ?? []) as { video_id: string; view_count: number | null; views_per_day: number | null; captured_at: string }[]) {
    if (!latestSnap.has(s.video_id)) latestSnap.set(s.video_id, s);
    if (Date.parse(s.captured_at) >= weekAgo) oldestRecent.set(s.video_id, s); // snaps are newest-first; last write wins = oldest recent
  }

  const videos: VideoPerf[] = ((vids ?? []) as Omit<VideoPerf, "view_count" | "views_per_day" | "ratio" | "flag">[]).map((v) => {
    const b = v.is_short ? baselines.shorts : baselines.longform;
    const hasSignal = formatHasSignal(b);
    const snap = latestSnap.get(v.id);
    const views = snap?.view_count ?? null;
    const ratio = views !== null && b?.median_views ? Math.round((views / b.median_views) * 100) / 100 : null;
    const oldest = oldestRecent.get(v.id);
    const views_week_delta =
      views !== null && oldest?.view_count !== null && oldest !== undefined &&
      oldest.captured_at !== (latestSnap.get(v.id) as { captured_at?: string } | undefined)?.captured_at
        ? views - (oldest.view_count as number)
        : null;
    return {
      ...v,
      view_count: views,
      views_per_day: snap?.views_per_day ?? null,
      ratio,
      views_week_delta,
      // No verdicts on noise: flags only exist where the format has real signal.
      flag: !hasSignal || ratio === null
        ? null
        : ratio >= 2 ? "outperformer" : ratio <= 0.5 ? "underperformer" : "typical",
    };
  });

  const flagsActive = formatHasSignal(baselines.longform) || formatHasSignal(baselines.shorts);
  return { channel, baselines, videos, flagsActive, lastUpdated };
}

/** Days since publish; null when unknown. */
export function daysAgo(publishedAt: string | null): number | null {
  if (!publishedAt) return null;
  return Math.floor((Date.now() - Date.parse(publishedAt)) / 86_400_000);
}

export function fmtNum(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}
