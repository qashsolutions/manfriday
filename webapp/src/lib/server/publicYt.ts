import { yt, isoDurationToSeconds, median } from "./youtube";

/** Public-data helpers for the Scout and the Researcher: anything here reads
    ONLY what YouTube shows everyone — view counts, titles, dates, channel
    sizes. Never revenue, never private analytics, never invented numbers. */

export type PublicVideo = {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
};

export type PublicChannel = {
  id: string;
  title: string;
  subscriberCount: number | null; // null when the channel hides it
  videoCount: number | null;
  publishedAt: string | null;
  uploadsPlaylistId: string | null;
};

export type ChannelNormal = {
  medianViews: number | null;
  sampleSize: number;
  recent: { title: string; viewCount: number | null; publishedAt: string | null }[];
};

/** Accepts a full YouTube URL (watch/shorts/live/youtu.be) or a bare 11-char id. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/\/(shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch { /* not a URL */ }
  return null;
}

export async function fetchPublicVideos(access: string, ids: string[]): Promise<PublicVideo[]> {
  if (!ids.length) return [];
  const out: PublicVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await yt(
      `videos?part=snippet,statistics,contentDetails&id=${batch.map(encodeURIComponent).join(",")}`,
      access
    );
    for (const it of (data.items as Record<string, any>[] | undefined) ?? []) {
      out.push({
        id: it.id,
        title: it.snippet?.title ?? "(untitled)",
        description: String(it.snippet?.description ?? "").slice(0, 1500),
        channelId: it.snippet?.channelId ?? "",
        channelTitle: it.snippet?.channelTitle ?? "",
        publishedAt: it.snippet?.publishedAt ?? null,
        durationSeconds: isoDurationToSeconds(it.contentDetails?.duration),
        viewCount: it.statistics?.viewCount != null ? Number(it.statistics.viewCount) : null,
        likeCount: it.statistics?.likeCount != null ? Number(it.statistics.likeCount) : null,
        commentCount: it.statistics?.commentCount != null ? Number(it.statistics.commentCount) : null,
      });
    }
  }
  return out;
}

export async function fetchPublicChannels(access: string, ids: string[]): Promise<Map<string, PublicChannel>> {
  const out = new Map<string, PublicChannel>();
  // Dedupe ONCE, then page over what's left. Paging over the raw ids while
  // slicing the deduped list walks off the end as soon as there are repeats —
  // a batch of 15 videos from 3 channels is one request, not three, and the
  // two extra ones would have gone out with an empty id list and thrown.
  // Blank ids come from videos whose snippet didn't carry a channel.
  const unique = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const data = await yt(
      `channels?part=snippet,statistics,contentDetails&id=${batch.map(encodeURIComponent).join(",")}`,
      access
    );
    for (const it of (data.items as Record<string, any>[] | undefined) ?? []) {
      out.set(it.id, {
        id: it.id,
        title: it.snippet?.title ?? "",
        subscriberCount:
          it.statistics?.hiddenSubscriberCount ? null :
          it.statistics?.subscriberCount != null ? Number(it.statistics.subscriberCount) : null,
        videoCount: it.statistics?.videoCount != null ? Number(it.statistics.videoCount) : null,
        publishedAt: it.snippet?.publishedAt ?? null,
        uploadsPlaylistId: it.contentDetails?.relatedPlaylists?.uploads ?? null,
      });
    }
  }
  return out;
}

/** A public channel's own recent normal: median views of its last ~25 uploads.
    This is what makes "their video ran hot FOR THEM" honest — a big channel's
    ordinary video is not a winner. */
export async function fetchChannelNormal(
  access: string,
  uploadsPlaylistId: string,
  excludeVideoId?: string
): Promise<ChannelNormal> {
  const data = await yt(
    `playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=25`,
    access
  );
  const ids = (((data.items as Record<string, any>[] | undefined) ?? [])
    .map((it) => it.contentDetails?.videoId)
    .filter(Boolean) as string[])
    .filter((id) => id !== excludeVideoId);
  const vids = await fetchPublicVideos(access, ids);
  const views = vids.map((v) => v.viewCount).filter((n): n is number => n !== null);
  return {
    medianViews: views.length >= 3 ? median(views) : null,
    sampleSize: views.length,
    recent: vids.slice(0, 10).map((v) => ({ title: v.title, viewCount: v.viewCount, publishedAt: v.publishedAt })),
  };
}

export async function searchPublicVideos(access: string, query: string, max = 15): Promise<string[]> {
  const data = await yt(
    `search?part=id&type=video&maxResults=${max}&q=${encodeURIComponent(query)}`,
    access
  );
  return (((data.items as Record<string, any>[] | undefined) ?? [])
    .map((it) => it.id?.videoId)
    .filter(Boolean) as string[]);
}

export type PublicComment = { text: string; likes: number };

/** Top public comments on one video, most relevant first. Returns [] when
    comments are off or unavailable — never throws.
    NOTE: YouTube's comment endpoints are NOT covered by the youtube.readonly
    OAuth scope (they'd need force-ssl, which we deliberately don't request),
    so public comments are read with the API key — they're public data. */
export async function fetchVideoComments(
  _access: string,
  videoId: string,
  max = 50
): Promise<PublicComment[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet` +
        `&videoId=${encodeURIComponent(videoId)}` +
        `&maxResults=${Math.min(max, 100)}&order=relevance&textFormat=plainText&key=${key}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, any>;
    const out: PublicComment[] = [];
    for (const item of (data.items as Record<string, any>[] | undefined) ?? []) {
      const s = item.snippet?.topLevelComment?.snippet;
      if (!s?.textDisplay) continue;
      out.push({ text: String(s.textDisplay).slice(0, 400), likes: Number(s.likeCount ?? 0) });
    }
    return out.slice(0, max);
  } catch {
    return [];
  }
}

/** What people actually type into YouTube — real suggestion phrases, never volumes. */
export async function typedPhrases(seed: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(seed)}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return [];
    const j = (await res.json()) as [string, string[]];
    return Array.isArray(j?.[1]) ? j[1].slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
}

export function fmtDuration(s: number | null): string {
  if (s === null) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Likes+comments per 1000 views — a public, comparable engagement signal. */
export function engagementPer1000(v: PublicVideo): number | null {
  if (!v.viewCount || v.viewCount <= 0) return null;
  const acts = (v.likeCount ?? 0) + (v.commentCount ?? 0);
  return Math.round((acts / v.viewCount) * 1000 * 10) / 10;
}
