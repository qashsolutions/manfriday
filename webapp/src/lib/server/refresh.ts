import type { SupabaseClient } from "@supabase/supabase-js";
import { yt, isoDurationToSeconds, median } from "./youtube";

/** One mechanical read of a connected channel: stats, last ~30 uploads,
    fresh snapshots, per-format baselines. Used by the first analysis AND the
    daily run — one implementation so the two can never drift. */

type YtVideoItem = {
  id: string;
  snippet?: { title?: string; publishedAt?: string; thumbnails?: { high?: { url?: string } } };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

export type RefreshResult = {
  channelId: string;
  videos: number;
  longform_median: number | null;
  shorts_median: number | null;
};

export async function refreshChannelData(
  svc: SupabaseClient,
  userId: string,
  access: string
): Promise<RefreshResult> {
  const chData = await yt("channels?part=snippet,statistics,contentDetails&mine=true", access);
  const ch = (chData.items as Record<string, any>[] | undefined)?.[0];
  if (!ch) throw new Error("Couldn't read the channel.");
  const uploadsId: string | undefined = ch.contentDetails?.relatedPlaylists?.uploads;
  const subs = ch.statistics?.subscriberCount ? Number(ch.statistics.subscriberCount) : null;

  const { data: chRow, error: chErr } = await svc
    .from("channels")
    .upsert(
      {
        user_id: userId,
        yt_channel_id: ch.id,
        title: ch.snippet?.title ?? null,
        handle: ch.snippet?.customUrl ?? null,
        is_owned: true,
        subscriber_count: subs,
        view_count: ch.statistics?.viewCount ? Number(ch.statistics.viewCount) : null,
        video_count: ch.statistics?.videoCount ? Number(ch.statistics.videoCount) : null,
        stats_refreshed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,yt_channel_id" }
    )
    .select("id")
    .single();
  if (chErr || !chRow) throw new Error(chErr?.message ?? "channel upsert failed");

  let videoIds: string[] = [];
  if (uploadsId) {
    const pl = await yt(`playlistItems?part=contentDetails&playlistId=${uploadsId}&maxResults=30`, access);
    videoIds = (((pl.items as Record<string, any>[] | undefined) ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter(Boolean)) as string[];
  }
  if (videoIds.length === 0) {
    return { channelId: chRow.id, videos: 0, longform_median: null, shorts_median: null };
  }

  const vidsData = await yt(
    `videos?part=snippet,statistics,contentDetails&id=${videoIds.join(",")}&maxResults=50`,
    access
  );
  const items = (vidsData.items as YtVideoItem[] | undefined) ?? [];

  const now = Date.now();
  const parsed = items.map((v) => {
    const dur = isoDurationToSeconds(v.contentDetails?.duration);
    const views = v.statistics?.viewCount ? Number(v.statistics.viewCount) : null;
    const publishedAt = v.snippet?.publishedAt ?? null;
    const days = publishedAt ? Math.max(1, (now - Date.parse(publishedAt)) / 86_400_000) : null;
    return {
      yt_video_id: v.id,
      title: v.snippet?.title ?? null,
      published_at: publishedAt,
      duration_seconds: dur,
      is_short: dur !== null ? dur <= 60 : null,
      thumbnail_url: v.snippet?.thumbnails?.high?.url ?? null,
      view_count: views,
      like_count: v.statistics?.likeCount ? Number(v.statistics.likeCount) : null,
      comment_count: v.statistics?.commentCount ? Number(v.statistics.commentCount) : null,
      views_per_day: views !== null && days ? Math.round(views / days) : null,
    };
  });

  const { data: vidRows, error: vErr } = await svc
    .from("videos")
    .upsert(
      parsed.map((p) => ({
        user_id: userId,
        channel_id: chRow.id,
        yt_video_id: p.yt_video_id,
        title: p.title,
        published_at: p.published_at,
        duration_seconds: p.duration_seconds,
        is_short: p.is_short,
        thumbnail_url: p.thumbnail_url,
      })),
      { onConflict: "user_id,yt_video_id" }
    )
    .select("id, yt_video_id");
  if (vErr) throw new Error(vErr.message);
  const idByYt = new Map((vidRows ?? []).map((r) => [r.yt_video_id as string, r.id as string]));

  const { error: sErr } = await svc.from("video_snapshots").insert(
    parsed
      .filter((p) => idByYt.has(p.yt_video_id))
      .map((p) => ({
        user_id: userId,
        video_id: idByYt.get(p.yt_video_id)!,
        view_count: p.view_count,
        like_count: p.like_count,
        comment_count: p.comment_count,
        views_per_day: p.views_per_day,
        source: "data_api",
      }))
  );
  if (sErr) throw new Error(sErr.message);

  // Per-format baselines (>=3 counted videos per format, like the local toolkit).
  const medians: Record<"longform" | "shorts", number | null> = { longform: null, shorts: null };
  for (const fmt of ["longform", "shorts"] as const) {
    const bucket = parsed.filter(
      (p) => p.view_count !== null && (fmt === "shorts" ? p.is_short === true : p.is_short !== true)
    );
    if (bucket.length < 3) continue;
    const views = bucket.map((p) => p.view_count!) as number[];
    const med = median(views);
    medians[fmt] = med;
    const detail = bucket
      .map((p) => ({
        video_id: p.yt_video_id,
        title: p.title,
        view_count: p.view_count,
        views_per_day: p.views_per_day,
        ratio_to_median: med ? Math.round((p.view_count! / med) * 100) / 100 : null,
        flag:
          med && p.view_count! >= med * 2 ? "outperformer"
          : med && p.view_count! <= med * 0.5 ? "underperformer"
          : "typical",
      }))
      .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
    const { error: bErr } = await svc.from("channel_baselines").insert({
      user_id: userId,
      channel_id: chRow.id,
      format: fmt,
      sample_requested: 30,
      sample_size: bucket.length,
      median_views: med,
      mean_views: Math.round(views.reduce((a, b) => a + b, 0) / views.length),
      subscribers: subs,
      videos: detail,
    });
    if (bErr) throw new Error(bErr.message);
  }

  return {
    channelId: chRow.id,
    videos: parsed.length,
    longform_median: medians.longform,
    shorts_median: medians.shorts,
  };
}
