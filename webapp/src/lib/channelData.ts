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
};

export type ChannelData = {
  channel: { id: string; title: string | null; handle: string | null; subscriber_count: number | null } | null;
  baselines: Partial<Record<"longform" | "shorts", Baseline>>;
  videos: VideoPerf[];
};

export async function loadChannelData(): Promise<ChannelData> {
  const supabase = supabaseBrowser();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { channel: null, baselines: {}, videos: [] };

  const { data: chans } = await supabase
    .from("channels")
    .select("id,title,handle,subscriber_count")
    .eq("is_owned", true)
    .limit(1);
  const channel = (chans?.[0] as ChannelData["channel"]) ?? null;
  if (!channel) return { channel: null, baselines: {}, videos: [] };

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

  const latestSnap = new Map<string, { view_count: number | null; views_per_day: number | null }>();
  for (const s of (snaps ?? []) as { video_id: string; view_count: number | null; views_per_day: number | null }[]) {
    if (!latestSnap.has(s.video_id)) latestSnap.set(s.video_id, s);
  }

  const videos: VideoPerf[] = ((vids ?? []) as Omit<VideoPerf, "view_count" | "views_per_day" | "ratio" | "flag">[]).map((v) => {
    const snap = latestSnap.get(v.id);
    const med = v.is_short ? baselines.shorts?.median_views : baselines.longform?.median_views;
    const views = snap?.view_count ?? null;
    const ratio = views !== null && med ? Math.round((views / med) * 100) / 100 : null;
    return {
      ...v,
      view_count: views,
      views_per_day: snap?.views_per_day ?? null,
      ratio,
      flag: ratio === null ? null : ratio >= 2 ? "outperformer" : ratio <= 0.5 ? "underperformer" : "typical",
    };
  });

  return { channel, baselines, videos };
}

export function fmtNum(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}
