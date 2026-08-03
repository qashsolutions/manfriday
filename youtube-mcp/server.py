"""YouTube MCP server.

Exposes YouTube tools over MCP: transcripts, video metadata + performance
stats, search, channel/playlist listing, comments, channel stats, and
Notion cataloging. Works on ANY public YouTube URL — no account required.

Access strategy (hybrid):
  - If YOUTUBE_API_KEY is set  -> YouTube Data API v3 for metadata, search,
    and comments (reliable, quota: 10k units/day free).
  - Always available (no key)  -> yt-dlp + youtube-transcript-api fallbacks,
    so every tool works even before an API key is configured.

Notion integration (optional):
  - NOTION_API_KEY      -> internal integration token (notion.so/my-integrations)
  - NOTION_DATABASE_ID  -> target database (create one with setup_notion_database)

Note: "how many subscribers watched this video" is owner-only YouTube Studio
data and is NOT publicly available. The public proxy exposed here is the
views-to-subscriber ratio (views ÷ channel subscribers).
"""

from __future__ import annotations

import os
import re
import time as _time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

try:  # mcp >= 2.0
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server

mcp = _Server("youtube")


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from .env (project root, then youtube-mcp/).
    Real environment variables win; empty values are treated as unset."""
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (
        os.path.join(os.path.dirname(here), ".env"),
        os.path.join(here, ".env"),
    ):
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key, value = key.strip(), value.strip().strip("'\"")
                    if value and not os.environ.get(key, "").strip():
                        os.environ[key] = value
        except OSError:
            pass


_load_dotenv()

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
ISO_DURATION_RE = re.compile(
    r"^P(?:(?P<d>\d+)D)?T?(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?$"
)
NOTION_VERSION = "2022-06-28"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")
CHAPTER_LINE_RE = re.compile(
    r"^\s*(?:[-•*]\s*)?((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:.)]?\s*(.+)$"
)

# OAuth (analytics for channels the user owns — read-only scopes)
OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]
_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRETS_PATH = os.environ.get("YT_OAUTH_CLIENT_SECRETS") or os.path.join(
    _SERVER_DIR, "client_secret.json"
)
TOKEN_PATH = os.environ.get("YT_OAUTH_TOKEN") or os.path.join(
    _SERVER_DIR, ".oauth-token.json"
)

# short-TTL cache so one analysis session doesn't refetch the same page 3x
CACHE_TTL = 900.0
_CACHE: dict[tuple, tuple[float, object]] = {}


def _cache_get(key: tuple):
    hit = _CACHE.get(key)
    if hit and _time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    _CACHE.pop(key, None)
    return None


def _cache_put(key: tuple, value) -> None:
    if len(_CACHE) > 128:
        for k, _ in sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:32]:
            _CACHE.pop(k, None)
    _CACHE[key] = (_time.time(), value)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _api_key() -> str | None:
    return os.environ.get("YOUTUBE_API_KEY", "").strip() or None


def _yt_api():
    from googleapiclient.discovery import build

    return build("youtube", "v3", developerKey=_api_key(), cache_discovery=False)


def _ydl(extra: dict | None = None):
    import yt_dlp

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noprogress": True,
    }
    if extra:
        opts.update(extra)
    return yt_dlp.YoutubeDL(opts)


_BLOCK_MARKERS = ("Sign in to confirm", "HTTP Error 429", "HTTP Error 403", "Too Many Requests")


def _scrape(url: str, mode: str = "full", extra: dict | None = None) -> dict:
    """yt-dlp extraction — LAST-RESORT fallback path, with caching, retries,
    and actionable errors. Official-API paths should be tried first."""
    key = ("ydl", url, mode)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    last: Exception | None = None
    for attempt in range(3):
        try:
            with _ydl(extra) as ydl:
                info = ydl.extract_info(url, download=False)
            _cache_put(key, info)
            return info
        except Exception as e:
            last = e
            if any(m in str(e) for m in _BLOCK_MARKERS):
                break  # bot-check / rate limit: backing off won't fix it this run
            _time.sleep(1.5 * (2**attempt))
    blocked = last is not None and any(m in str(last) for m in _BLOCK_MARKERS)
    raise ValueError(
        f"YouTube extraction failed for {url}: {str(last)[:200]}. "
        + ("YouTube rate-limited or bot-checked this IP. " if blocked else "")
        + "Fixes: set YOUTUBE_API_KEY so official-API paths are used instead of "
        "scraping; wait a few minutes and retry; or update the extractor with "
        "`youtube-mcp/.venv/bin/pip install -U yt-dlp`."
    )


def _resolve_channel_id(s: str) -> str | None:
    """Resolve any channel reference (handle, URL, name) to a UC... ID via the
    Data API. Cached. Returns None when unresolvable."""
    s = s.strip()
    if s.startswith("UC") and len(s) == 24:
        return s
    m = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})", s)
    if m:
        return m.group(1)
    key = ("chanid", s)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    api = _yt_api()
    handle = None
    if s.startswith("@"):
        handle = s
    elif "youtube.com" in s:
        mh = re.search(r"/(@[A-Za-z0-9._-]+)", s)
        if mh:
            handle = mh.group(1)
    cid = None
    if handle:
        resp = api.channels().list(part="id", forHandle=handle).execute()
        items = resp.get("items", [])
        cid = items[0]["id"] if items else None
    if not cid:
        resp = api.search().list(part="snippet", q=s, type="channel", maxResults=1).execute()
        items = resp.get("items", [])
        cid = items[0]["snippet"]["channelId"] if items else None
    if cid:
        _cache_put(key, cid)
    return cid


def _channel_uploads_api(channel_id: str, n: int) -> tuple[dict, list[str]]:
    """Return (channel resource, latest n upload video IDs) via the Data API."""
    api = _yt_api()
    ch_items = (
        api.channels()
        .list(part="snippet,statistics,contentDetails", id=channel_id)
        .execute()
        .get("items", [])
    )
    if not ch_items:
        raise ValueError(f"Channel not found: {channel_id}")
    ch = ch_items[0]
    uploads = ch["contentDetails"]["relatedPlaylists"]["uploads"]
    ids: list[str] = []
    page = None
    while len(ids) < n:
        resp = (
            api.playlistItems()
            .list(
                part="contentDetails",
                playlistId=uploads,
                maxResults=min(50, n - len(ids)),
                pageToken=page,
            )
            .execute()
        )
        ids.extend(it["contentDetails"]["videoId"] for it in resp.get("items", []))
        page = resp.get("nextPageToken")
        if not page:
            break
    return ch, ids[:n]


def _videos_stats_api(ids: list[str]) -> list[dict]:
    """Batch-fetch title/duration/views/publish date for up to 50 IDs per call."""
    api = _yt_api()
    out: list[dict] = []
    for j in range(0, len(ids), 50):
        resp = (
            api.videos()
            .list(part="snippet,statistics,contentDetails", id=",".join(ids[j : j + 50]))
            .execute()
        )
        for it in resp.get("items", []):
            sn, st, cd = it["snippet"], it.get("statistics", {}), it.get("contentDetails", {})
            dur = _iso_duration_to_seconds(cd.get("duration", ""))
            out.append(
                {
                    "video_id": it["id"],
                    "url": _watch_url(it["id"]),
                    "title": sn.get("title"),
                    "published_at": sn.get("publishedAt"),
                    "duration_seconds": dur,
                    "is_short": dur <= 60 if dur is not None else None,
                    "view_count": int(st["viewCount"]) if "viewCount" in st else None,
                }
            )
    # preserve upload order
    order = {vid: i for i, vid in enumerate(ids)}
    out.sort(key=lambda v: order.get(v["video_id"], 999))
    return out


def extract_video_id(url_or_id: str) -> str:
    """Accept a bare 11-char video ID or any common YouTube URL form."""
    s = url_or_id.strip()
    if VIDEO_ID_RE.match(s):
        return s
    u = urlparse(s if "//" in s else f"https://{s}")
    host = (u.hostname or "").lower()
    for prefix in ("www.", "m.", "music."):
        host = host.removeprefix(prefix)
    vid = ""
    if host == "youtu.be":
        vid = u.path.lstrip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if u.path == "/watch":
            vid = parse_qs(u.query).get("v", [""])[0]
        else:
            parts = u.path.split("/")
            if len(parts) >= 3 and parts[1] in ("shorts", "embed", "live", "v"):
                vid = parts[2]
    if not VIDEO_ID_RE.match(vid):
        raise ValueError(f"Could not extract a YouTube video ID from: {url_or_id!r}")
    return vid


def _iso_duration_to_seconds(value: str) -> int | None:
    m = ISO_DURATION_RE.match(value or "")
    if not m:
        return None
    g = {k: int(v) for k, v in m.groupdict().items() if v}
    return g.get("d", 0) * 86400 + g.get("h", 0) * 3600 + g.get("m", 0) * 60 + g.get("s", 0)


def _fmt_ts(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def _watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _duration_bucket(seconds: int | None) -> str | None:
    if seconds is None:
        return None
    if seconds < 60:
        return "Short (<1 min)"
    if seconds < 300:
        return "1-5 min"
    if seconds < 1200:
        return "5-20 min"
    if seconds < 3600:
        return "20-60 min"
    return "60+ min"


def _performance(
    view_count: int | None,
    like_count: int | None,
    comment_count: int | None,
    published_at: str | None,
    subscribers: int | None,
) -> dict:
    """Derived performance metrics from public stats."""
    days = None
    if published_at:
        try:
            dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            days = max((datetime.now(timezone.utc) - dt).days, 1)
        except ValueError:
            pass
    return {
        "days_since_published": days,
        "views_per_day": round(view_count / days, 1) if view_count and days else None,
        "likes_per_1000_views": round(like_count / view_count * 1000, 2)
        if like_count and view_count
        else None,
        "comments_per_1000_views": round(comment_count / view_count * 1000, 2)
        if comment_count and view_count
        else None,
        "channel_subscribers": subscribers,
        "views_to_subscriber_ratio": round(view_count / subscribers, 3)
        if view_count and subscribers
        else None,
        "note": "views_to_subscriber_ratio is the public proxy for audience reach; "
        "the true 'subscribers who watched' number is owner-only YouTube Studio data.",
    }


def _parse_desc_chapters(description: str | None) -> list[dict]:
    """Extract a chapter list from timestamp lines in a video description."""
    if not description:
        return []
    out = []
    for line in description.splitlines():
        m = CHAPTER_LINE_RE.match(line.strip())
        if m:
            ts, title = m.groups()
            parts = [int(p) for p in ts.split(":")]
            secs = (
                parts[0] * 3600 + parts[1] * 60 + parts[2]
                if len(parts) == 3
                else parts[0] * 60 + parts[1]
            )
            out.append({"start_seconds": secs, "timestamp": ts, "title": title.strip()})
    # a valid chapter list starts at 0:00, is ascending, and has >= 2 entries
    if (
        len(out) >= 2
        and out[0]["start_seconds"] == 0
        and all(out[i]["start_seconds"] < out[i + 1]["start_seconds"] for i in range(len(out) - 1))
    ):
        return out
    return []


def _video_info(vid: str) -> dict:
    """Fetch full metadata + derived performance stats for a video."""
    if _api_key():
        try:
            resp = (
                _yt_api()
                .videos()
                .list(part="snippet,statistics,contentDetails", id=vid)
                .execute()
            )
            items = resp.get("items", [])
            if items:
                sn = items[0]["snippet"]
                st = items[0].get("statistics", {})
                cd = items[0].get("contentDetails", {})
                subs = None
                try:
                    ch = (
                        _yt_api()
                        .channels()
                        .list(part="statistics", id=sn.get("channelId"))
                        .execute()
                    )
                    ch_items = ch.get("items", [])
                    if ch_items:
                        subs = int(ch_items[0]["statistics"].get("subscriberCount", 0)) or None
                except Exception:
                    pass
                view_count = int(st["viewCount"]) if "viewCount" in st else None
                like_count = int(st["likeCount"]) if "likeCount" in st else None
                comment_count = int(st["commentCount"]) if "commentCount" in st else None
                duration = _iso_duration_to_seconds(cd.get("duration", ""))
                return {
                    "video_id": vid,
                    "url": _watch_url(vid),
                    "title": sn.get("title"),
                    "channel": sn.get("channelTitle"),
                    "channel_id": sn.get("channelId"),
                    "published_at": sn.get("publishedAt"),
                    "duration_seconds": duration,
                    "duration_bucket": _duration_bucket(duration),
                    "is_short": duration <= 60 if duration is not None else None,
                    "chapters": _parse_desc_chapters(sn.get("description")),
                    "view_count": view_count,
                    "like_count": like_count,
                    "comment_count": comment_count,
                    "tags": sn.get("tags", []),
                    "description": sn.get("description"),
                    "performance": _performance(
                        view_count, like_count, comment_count, sn.get("publishedAt"), subs
                    ),
                    "source": "youtube_data_api",
                }
        except Exception:
            pass  # fall through to yt-dlp

    info = _scrape(_watch_url(vid), "full")
    upload_date = info.get("upload_date")  # YYYYMMDD
    if upload_date and len(upload_date) == 8:
        upload_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
    duration = info.get("duration")
    view_count = info.get("view_count")
    like_count = info.get("like_count")
    comment_count = info.get("comment_count")
    subs = info.get("channel_follower_count")
    w, h = info.get("width"), info.get("height")
    if duration is None:
        is_short = None
    elif h and w:
        is_short = duration <= 180 and h > w
    else:
        is_short = duration <= 60
    chapters = [
        {
            "start_seconds": int(c.get("start_time", 0)),
            "timestamp": _fmt_ts(c.get("start_time", 0)),
            "title": c.get("title"),
        }
        for c in (info.get("chapters") or [])
    ] or _parse_desc_chapters(info.get("description"))
    return {
        "video_id": vid,
        "url": _watch_url(vid),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_id": info.get("channel_id"),
        "published_at": upload_date,
        "duration_seconds": duration,
        "duration_bucket": _duration_bucket(duration),
        "is_short": is_short,
        "chapters": chapters,
        "view_count": view_count,
        "like_count": like_count,
        "comment_count": comment_count,
        "tags": info.get("tags", []),
        "description": info.get("description"),
        "performance": _performance(view_count, like_count, comment_count, upload_date, subs),
        "source": "yt-dlp",
    }


def _normalize_channel_url(channel: str) -> str:
    s = channel.strip()
    if s.startswith(("http://", "https://")):
        url = s.rstrip("/")
        if not url.endswith(("/videos", "/streams", "/shorts")):
            url += "/videos"
        return url
    if s.startswith("@"):
        return f"https://www.youtube.com/{s}/videos"
    if s.startswith("UC") and len(s) == 24:
        return f"https://www.youtube.com/channel/{s}/videos"
    return f"https://www.youtube.com/@{s.replace(' ', '')}/videos"


# ---------------------------------------------------------------------------
# YouTube tools
# ---------------------------------------------------------------------------

@mcp.tool()
def get_video_info(url: str) -> dict:
    """Get metadata AND performance stats for a YouTube video: title, channel,
    duration, views, likes, publish date, description, plus derived metrics —
    views per day, likes per 1000 views, channel subscribers, and the
    views-to-subscriber ratio (public proxy for how far the video reached
    beyond the channel's subscriber base).

    Args:
        url: A YouTube video URL (watch / shorts / youtu.be / embed / live)
            or a bare 11-character video ID.
    """
    return _video_info(extract_video_id(url))


@mcp.tool()
def get_transcript(url: str, language: str = "en", include_timestamps: bool = False) -> dict:
    """Fetch the transcript/captions of a YouTube video. Works without an API
    key. Falls back to any available language if the requested one is missing.

    Args:
        url: A YouTube video URL or bare 11-character video ID.
        language: Preferred transcript language code (e.g. "en", "es", "hi").
        include_timestamps: If true, prefix each line with its [h:mm:ss] start time.
    """
    from youtube_transcript_api import YouTubeTranscriptApi

    vid = extract_video_id(url)
    api = YouTubeTranscriptApi()
    langs = [language] if language == "en" else [language, "en"]
    try:
        fetched = api.fetch(vid, languages=langs)
    except Exception:
        # requested language unavailable — take the first transcript that exists
        try:
            transcript_list = api.list(vid)
            first = next(iter(transcript_list), None)
            if first is None:
                raise ValueError("empty transcript list")
            fetched = first.fetch()
        except Exception as e:
            raise ValueError(
                f"No transcript could be fetched for video {vid}: {str(e)[:150]}. "
                "Either captions are disabled for this video, or YouTube is "
                "blocking transcript requests from this IP — wait a few minutes "
                "and retry. There is no official API for transcripts; analysis "
                "can proceed from metadata/description only."
            )

    snippets = list(fetched)
    if include_timestamps:
        text = "\n".join(f"[{_fmt_ts(s.start)}] {s.text}" for s in snippets)
    else:
        text = " ".join(s.text for s in snippets)
    return {
        "video_id": vid,
        "url": _watch_url(vid),
        "language": getattr(fetched, "language_code", None),
        "is_auto_generated": getattr(fetched, "is_generated", None),
        "segment_count": len(snippets),
        "text": text,
    }


@mcp.tool()
def search_videos(query: str, max_results: int = 10) -> list[dict]:
    """Search YouTube for videos matching a query.

    Args:
        query: The search terms.
        max_results: Number of results to return (1-50).
    """
    n = max(1, min(int(max_results), 50))
    if _api_key():
        try:
            resp = (
                _yt_api()
                .search()
                .list(part="snippet", q=query, type="video", maxResults=n)
                .execute()
            )
            return [
                {
                    "video_id": it["id"]["videoId"],
                    "url": _watch_url(it["id"]["videoId"]),
                    "title": it["snippet"]["title"],
                    "channel": it["snippet"]["channelTitle"],
                    "published_at": it["snippet"]["publishedAt"],
                    "description": it["snippet"]["description"],
                }
                for it in resp.get("items", [])
            ]
        except Exception:
            pass  # fall through to yt-dlp

    info = _scrape(f"ytsearch{n}:{query}", f"search:{n}", {"extract_flat": "in_playlist"})
    return [
        {
            "video_id": e.get("id"),
            "url": _watch_url(e.get("id", "")),
            "title": e.get("title"),
            "channel": e.get("channel") or e.get("uploader"),
            "duration_seconds": e.get("duration"),
            "view_count": e.get("view_count"),
        }
        for e in (info.get("entries") or [])
    ]


@mcp.tool()
def get_channel_videos(channel: str, max_results: int = 20) -> dict:
    """List the most recent uploads of a YouTube channel.

    Args:
        channel: A channel URL (youtube.com/@handle, /channel/UC..., /c/name),
            a bare @handle, or a channel name.
        max_results: Number of videos to return (1-100).
    """
    n = max(1, min(int(max_results), 100))
    if _api_key():
        try:
            cid = _resolve_channel_id(channel)
            if cid:
                ch, ids = _channel_uploads_api(cid, n)
                return {
                    "channel": ch["snippet"].get("title"),
                    "channel_id": cid,
                    "channel_url": f"https://www.youtube.com/channel/{cid}",
                    "subscribers": int(ch["statistics"].get("subscriberCount", 0)) or None,
                    "videos": _videos_stats_api(ids),
                    "source": "youtube_data_api",
                }
        except Exception:
            pass  # fall through to scraping
    url = _normalize_channel_url(channel)
    info = _scrape(url, f"flat:{n}", {"extract_flat": "in_playlist", "playlistend": n})
    entries = (info.get("entries") or [])[:n]
    return {
        "channel": info.get("channel") or info.get("uploader") or info.get("title"),
        "channel_id": info.get("channel_id"),
        "channel_url": info.get("channel_url") or url,
        "subscribers": info.get("channel_follower_count"),
        "videos": [
            {
                "video_id": e.get("id"),
                "url": _watch_url(e.get("id", "")),
                "title": e.get("title"),
                "duration_seconds": e.get("duration"),
                "view_count": e.get("view_count"),
            }
            for e in entries
        ],
        "source": "yt-dlp",
    }


@mcp.tool()
def get_channel_stats(channel: str) -> dict:
    """Get public stats for a YouTube channel: subscriber count, total views,
    and video count. Useful for normalizing video performance across channels
    of different sizes.

    Args:
        channel: A channel URL, bare @handle, channel ID (UC...), or name.
    """
    s = channel.strip()
    if _api_key():
        try:
            api = _yt_api()
            kwargs = None
            if s.startswith("UC") and len(s) == 24:
                kwargs = {"id": s}
            else:
                handle = None
                if s.startswith("@"):
                    handle = s
                elif "youtube.com" in s:
                    m = re.search(r"/(@[A-Za-z0-9._-]+)", s)
                    if m:
                        handle = m.group(1)
                    else:
                        m = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})", s)
                        if m:
                            kwargs = {"id": m.group(1)}
                if handle:
                    kwargs = {"forHandle": handle}
            if kwargs:
                resp = api.channels().list(part="snippet,statistics", **kwargs).execute()
                items = resp.get("items", [])
                if items:
                    sn, st = items[0]["snippet"], items[0]["statistics"]
                    return {
                        "channel": sn.get("title"),
                        "channel_id": items[0].get("id"),
                        "created_at": sn.get("publishedAt"),
                        "subscribers": int(st.get("subscriberCount", 0)) or None,
                        "total_views": int(st.get("viewCount", 0)) or None,
                        "video_count": int(st.get("videoCount", 0)) or None,
                        "description": sn.get("description"),
                        "source": "youtube_data_api",
                    }
        except Exception:
            pass  # fall through to yt-dlp

    url = _normalize_channel_url(s)
    info = _scrape(url, "flat:1", {"extract_flat": "in_playlist", "playlistend": 1})
    return {
        "channel": info.get("channel") or info.get("uploader") or info.get("title"),
        "channel_id": info.get("channel_id"),
        "subscribers": info.get("channel_follower_count"),
        "total_views": None,
        "video_count": info.get("playlist_count"),
        "description": info.get("description"),
        "source": "yt-dlp",
    }


@mcp.tool()
def get_playlist_videos(playlist: str, max_results: int = 50) -> dict:
    """Expand a YouTube playlist into its list of videos.

    Args:
        playlist: A playlist URL or bare playlist ID (starts with PL, UU, OL...).
        max_results: Number of videos to return (1-200).
    """
    n = max(1, min(int(max_results), 200))
    s = playlist.strip()
    m = re.search(r"[?&]list=([A-Za-z0-9_-]+)", s)
    playlist_id = m.group(1) if m else (s if not s.startswith(("http://", "https://")) else None)
    if _api_key() and playlist_id:
        try:
            api = _yt_api()
            ids: list[str] = []
            titles: dict[str, dict] = {}
            page = None
            pl_title = None
            while len(ids) < n:
                resp = (
                    api.playlistItems()
                    .list(
                        part="snippet,contentDetails",
                        playlistId=playlist_id,
                        maxResults=min(50, n - len(ids)),
                        pageToken=page,
                    )
                    .execute()
                )
                for it in resp.get("items", []):
                    vid = it["contentDetails"]["videoId"]
                    ids.append(vid)
                    titles[vid] = {
                        "title": it["snippet"].get("title"),
                        "channel": it["snippet"].get("videoOwnerChannelTitle"),
                    }
                page = resp.get("nextPageToken")
                if not page:
                    break
            return {
                "playlist_title": pl_title,
                "playlist_id": playlist_id,
                "video_count": len(ids),
                "videos": [
                    {
                        "video_id": v,
                        "url": _watch_url(v),
                        "title": titles[v]["title"],
                        "channel": titles[v]["channel"],
                        "duration_seconds": None,
                    }
                    for v in ids
                ],
                "source": "youtube_data_api",
            }
        except Exception:
            pass  # fall through to scraping
    url = s if s.startswith(("http://", "https://")) else f"https://www.youtube.com/playlist?list={s}"
    info = _scrape(url, f"flat:{n}", {"extract_flat": "in_playlist", "playlistend": n})
    entries = (info.get("entries") or [])[:n]
    return {
        "playlist_title": info.get("title"),
        "playlist_id": info.get("id"),
        "video_count": len(entries),
        "videos": [
            {
                "video_id": e.get("id"),
                "url": _watch_url(e.get("id", "")),
                "title": e.get("title"),
                "channel": e.get("channel") or e.get("uploader"),
                "duration_seconds": e.get("duration"),
            }
            for e in entries
        ],
    }


@mcp.tool()
def get_comments(url: str, max_results: int = 20, order: str = "relevance") -> list[dict]:
    """Fetch top-level comments on a YouTube video. Useful for judging audience
    reaction — what viewers praise or complain about.

    Args:
        url: A YouTube video URL or bare 11-character video ID.
        max_results: Number of comments to return (1-100).
        order: "relevance" (top comments) or "time" (newest first).
            Only honored when a YouTube Data API key is configured.
    """
    vid = extract_video_id(url)
    n = max(1, min(int(max_results), 100))
    if _api_key():
        try:
            resp = (
                _yt_api()
                .commentThreads()
                .list(
                    part="snippet",
                    videoId=vid,
                    maxResults=n,
                    order=order if order in ("relevance", "time") else "relevance",
                    textFormat="plainText",
                )
                .execute()
            )
            out = []
            for it in resp.get("items", []):
                c = it["snippet"]["topLevelComment"]["snippet"]
                out.append(
                    {
                        "author": c.get("authorDisplayName"),
                        "text": c.get("textDisplay"),
                        "like_count": c.get("likeCount"),
                        "published_at": c.get("publishedAt"),
                        "reply_count": it["snippet"].get("totalReplyCount"),
                    }
                )
            return out
        except Exception:
            pass  # fall through to yt-dlp

    info = _scrape(
        _watch_url(vid),
        f"comments:{n}",
        {
            "getcomments": True,
            "extractor_args": {"youtube": {"max_comments": [str(n), "all", "0"]}},
        },
    )
    comments = info.get("comments") or []
    return [
        {
            "author": c.get("author"),
            "text": c.get("text"),
            "like_count": c.get("like_count"),
            "published_at": c.get("_time_text") or c.get("timestamp"),
        }
        for c in comments[:n]
    ]


@mcp.tool()
def get_thumbnail(url: str) -> dict:
    """Download a video's thumbnail image to a local file so an agent can view
    and critique it visually. Use the Read tool on the returned file_path to
    SEE the image (contrast, text amount, faces, composition).

    Args:
        url: A YouTube video URL or bare 11-character video ID.
    """
    import requests

    vid = extract_video_id(url)
    out_dir = os.path.join(REPORTS_DIR, "thumbnails")
    os.makedirs(out_dir, exist_ok=True)
    for quality in ("maxresdefault", "sddefault", "hqdefault", "mqdefault"):
        cached = os.path.join(out_dir, f"{vid}_{quality}.jpg")
        if os.path.exists(cached):
            return {
                "video_id": vid,
                "file_path": cached,
                "quality": quality,
                "bytes": os.path.getsize(cached),
                "note": "Already downloaded. Use the Read tool on file_path to view the image.",
            }
    for quality in ("maxresdefault", "sddefault", "hqdefault", "mqdefault"):
        try:
            r = requests.get(
                f"https://i.ytimg.com/vi/{vid}/{quality}.jpg", timeout=20
            )
        except Exception:
            continue
        # YouTube serves a tiny gray placeholder for missing qualities
        if r.status_code == 200 and len(r.content) > 2000:
            path = os.path.join(out_dir, f"{vid}_{quality}.jpg")
            with open(path, "wb") as f:
                f.write(r.content)
            return {
                "video_id": vid,
                "file_path": path,
                "quality": quality,
                "bytes": len(r.content),
                "note": "Use the Read tool on file_path to view the image.",
            }
    raise ValueError(f"No thumbnail could be downloaded for video {vid}")


@mcp.tool()
def get_video_heatmap(url: str, top_peaks: int = 5) -> dict:
    """Get the public 'most replayed' heatmap for a video — the closest public
    proxy to a retention curve, with NO channel ownership or OAuth required.
    Peaks show the moments viewers rewatch most; a flat/absent heatmap means
    YouTube hasn't exposed one (typically lower-traffic videos).

    Args:
        url: A YouTube video URL or bare 11-character video ID.
        top_peaks: How many top replayed moments to return (1-20).
    """
    vid = extract_video_id(url)
    info = _scrape(_watch_url(vid), "full")
    hm = info.get("heatmap")
    if not hm:
        return {
            "video_id": vid,
            "available": False,
            "note": "YouTube does not expose a most-replayed heatmap for this video.",
        }
    points = [
        {
            "start": round(p.get("start_time", 0), 1),
            "end": round(p.get("end_time", 0), 1),
            "value": round(p.get("value", 0), 4),
        }
        for p in hm
    ]
    k = max(1, min(int(top_peaks), 20))
    peaks = sorted(points, key=lambda p: -p["value"])[:k]
    peaks = [
        {"timestamp": _fmt_ts(p["start"]), **p}
        for p in sorted(peaks, key=lambda p: p["start"])
    ]
    step = max(1, len(points) // 25)
    return {
        "video_id": vid,
        "url": _watch_url(vid),
        "available": True,
        "duration_seconds": info.get("duration"),
        "most_replayed_peaks": peaks,
        "curve_sample": points[::step],
        "note": "value is normalized replay intensity 0-1. Peaks = moments that "
        "worked; a curve that decays fast after 0:00 suggests a weak hook.",
    }


@mcp.tool()
def get_search_suggestions(query: str, fanout: bool = False) -> dict:
    """Get YouTube search autocomplete suggestions — real queries people type
    into YouTube search. A free demand-side signal for ideation, titles, and
    tags (no API key needed).

    Args:
        query: Seed query (e.g. "claude code").
        fanout: If true, also query '<query> a' through '<query> z' to surface
            the long tail (slower: ~27 requests).
    """
    import requests

    def fetch(q: str) -> list[str]:
        r = requests.get(
            "https://suggestqueries.google.com/complete/search",
            params={"client": "firefox", "ds": "yt", "q": q},
            timeout=15,
        )
        r.raise_for_status()
        r.encoding = "utf-8"
        data = r.json()
        return list(data[1]) if len(data) > 1 else []

    base = fetch(query)
    out = {"query": query, "suggestions": base}
    if fanout:
        seen = dict.fromkeys(base)
        for c in "abcdefghijklmnopqrstuvwxyz":
            try:
                for s in fetch(f"{query} {c}"):
                    seen.setdefault(s)
            except Exception:
                continue
        out["fanout_suggestions"] = list(seen)
    return out


@mcp.tool()
def get_channel_baseline(channel: str, sample: int = 15) -> dict:
    """Compute a channel's performance baseline over its recent uploads and
    flag outliers — videos over/under-performing the channel's own norm.
    Shorts and long-form are baselined SEPARATELY (YouTube ranks them
    separately). An 'outperformer' (>=2x the median of its format) shows what
    is working for this audience; an 'underperformer' (<=0.5x) what is not.

    Args:
        channel: A channel URL, bare @handle, channel ID (UC...), or name.
        sample: How many recent uploads to baseline over (5-50).
    """
    import statistics

    n = max(5, min(int(sample), 50))
    videos: list[dict] = []
    meta = {"channel": None, "channel_id": None, "subscribers": None}

    if _api_key():
        try:
            cid = _resolve_channel_id(channel)
            if cid:
                ch, ids = _channel_uploads_api(cid, n)
                meta = {
                    "channel": ch["snippet"].get("title"),
                    "channel_id": cid,
                    "subscribers": int(ch["statistics"].get("subscriberCount", 0)) or None,
                }
                for v in _videos_stats_api(ids):
                    perf = _performance(v["view_count"], None, None, v["published_at"], None)
                    v["views_per_day"] = perf["views_per_day"]
                    videos.append(v)
        except Exception:
            videos = []

    if not videos:
        url = _normalize_channel_url(channel)
        listing = _scrape(url, f"flat:{n}", {"extract_flat": "in_playlist", "playlistend": n})
        entries = (listing.get("entries") or [])[:n]
        if not entries:
            raise ValueError(f"No videos found for channel: {channel}")
        meta = {
            "channel": listing.get("channel") or listing.get("uploader") or listing.get("title"),
            "channel_id": listing.get("channel_id"),
            "subscribers": listing.get("channel_follower_count"),
        }
        for e in entries:
            dur = e.get("duration")
            videos.append(
                {
                    "video_id": e.get("id"),
                    "title": e.get("title"),
                    "url": _watch_url(e.get("id", "")),
                    "published_at": None,
                    "duration_seconds": dur,
                    "is_short": dur <= 60 if dur is not None else None,
                    "view_count": e.get("view_count"),
                    "views_per_day": None,
                }
            )

    def classify(bucket: list[dict]) -> dict | None:
        counted = [v for v in bucket if v.get("view_count")]
        if len(counted) < 3:
            return None
        med = statistics.median(v["view_count"] for v in counted)
        for v in counted:
            ratio = round(v["view_count"] / med, 2) if med else None
            v["ratio_to_median"] = ratio
            v["flag"] = (
                "outperformer"
                if ratio and ratio >= 2
                else "underperformer"
                if ratio and ratio <= 0.5
                else "typical"
            )
        return {
            "sample_size": len(counted),
            "median_views": int(med),
            "mean_views": int(statistics.mean(v["view_count"] for v in counted)),
            "videos": sorted(counted, key=lambda v: -(v.get("view_count") or 0)),
        }

    longform = classify([v for v in videos if v.get("is_short") is not True])
    shorts = classify([v for v in videos if v.get("is_short") is True])
    return {
        **meta,
        "longform_baseline": longform,
        "shorts_baseline": shorts,
        "note": "Baselines are per-format because YouTube ranks Shorts and "
        "long-form separately. Flags: outperformer >= 2x median of its format, "
        "underperformer <= 0.5x.",
    }


@mcp.tool()
def get_channel_rss(channel: str) -> dict:
    """Latest uploads of a channel via YouTube's OFFICIAL RSS feed — the most
    robust way to detect new videos: no scraping, no API key, no quota. Returns
    up to 15 most recent videos with publish dates and view counts. Preferred
    for monitoring; use get_channel_videos when you need more history.

    Args:
        channel: A channel URL, bare @handle, channel ID (UC...), or name.
    """
    import xml.etree.ElementTree as ET

    import requests

    s = channel.strip()
    cid = None
    if s.startswith("UC") and len(s) == 24:
        cid = s
    else:
        m = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})", s)
        if m:
            cid = m.group(1)
    if not cid and _api_key():
        try:
            cid = _resolve_channel_id(s)
        except Exception:
            cid = None
    if not cid:
        info = _scrape(
            _normalize_channel_url(s), "flat:1", {"extract_flat": "in_playlist", "playlistend": 1}
        )
        cid = info.get("channel_id")
    if not cid:
        raise ValueError(f"Could not resolve a channel ID for {channel!r}")

    r = requests.get(
        f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}", timeout=20
    )
    r.raise_for_status()
    root = ET.fromstring(r.content)
    ns = {
        "a": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    videos = []
    for e in root.findall("a:entry", ns):
        vid = e.findtext("yt:videoId", None, ns)
        stats = e.find("media:group/media:community/media:statistics", ns)
        videos.append(
            {
                "video_id": vid,
                "url": _watch_url(vid or ""),
                "title": e.findtext("a:title", None, ns),
                "published_at": e.findtext("a:published", None, ns),
                "view_count": int(stats.get("views"))
                if stats is not None and stats.get("views")
                else None,
            }
        )
    return {
        "channel": root.findtext("a:title", None, ns),
        "channel_id": cid,
        "videos": videos,
        "source": "youtube_rss",
    }


# ---------------------------------------------------------------------------
# OAuth analytics tools (channels the USER OWNS — read-only)
# ---------------------------------------------------------------------------

def _oauth_creds():
    """Load (and silently refresh) the stored OAuth token; None if not set up."""
    if not os.path.exists(TOKEN_PATH):
        return None
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = Credentials.from_authorized_user_file(TOKEN_PATH, OAUTH_SCOPES)
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(TOKEN_PATH, "w") as f:
                f.write(creds.to_json())
        except Exception:
            return None
    return creds if creds.valid else None


_OAUTH_HOWTO = (
    "OAuth is not set up (these tools read private analytics and work ONLY for "
    "channels the user owns). One-time setup: 1) In Google Cloud Console, enable "
    "'YouTube Data API v3' AND 'YouTube Analytics API', create an OAuth client of "
    f"type 'Desktop app', and save its JSON as {CLIENT_SECRETS_PATH}. 2) Run in a "
    "terminal: youtube-mcp/.venv/bin/python youtube-mcp/authorize.py (opens a "
    "browser for Google sign-in). 3) Retry this tool."
)


def _yt_analytics():
    creds = _oauth_creds()
    if creds is None:
        raise ValueError(_OAUTH_HOWTO)
    from googleapiclient.discovery import build

    return build("youtubeAnalytics", "v2", credentials=creds, cache_discovery=False)


def _yt_data_oauth():
    creds = _oauth_creds()
    if creds is None:
        raise ValueError(_OAUTH_HOWTO)
    from googleapiclient.discovery import build

    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def _aq(
    metrics: str,
    dimensions: str | None = None,
    filters: str | None = None,
    sort: str | None = None,
    max_results: int | None = None,
    start_date: str = "",
    end_date: str = "",
) -> dict:
    """Run a YouTube Analytics API query for the authenticated user's channel."""
    from datetime import date, timedelta

    end = end_date.strip() or date.today().isoformat()
    start = start_date.strip() or (date.fromisoformat(end) - timedelta(days=28)).isoformat()
    kwargs: dict = {"ids": "channel==MINE", "startDate": start, "endDate": end, "metrics": metrics}
    if dimensions:
        kwargs["dimensions"] = dimensions
    if filters:
        kwargs["filters"] = filters
    if sort:
        kwargs["sort"] = sort
    if max_results:
        kwargs["maxResults"] = max_results
    resp = _yt_analytics().reports().query(**kwargs).execute()
    headers = [h["name"] for h in resp.get("columnHeaders", [])]
    rows = [dict(zip(headers, r)) for r in (resp.get("rows") or [])]
    return {"start_date": start, "end_date": end, "rows": rows}


@mcp.tool()
def get_oauth_status() -> dict:
    """Check whether OAuth analytics access is configured, and for which
    channel. Call this before any get_my_* tool when unsure.
    """
    creds = _oauth_creds()
    if creds is None:
        return {"authorized": False, "setup": _OAUTH_HOWTO}
    from googleapiclient.discovery import build

    api = build("youtube", "v3", credentials=creds, cache_discovery=False)
    items = api.channels().list(part="snippet,statistics", mine=True).execute().get("items", [])
    if not items:
        return {"authorized": True, "channel": None, "note": "Token valid but no channel found."}
    ch = items[0]
    return {
        "authorized": True,
        "channel": ch["snippet"].get("title"),
        "channel_id": ch.get("id"),
        "subscribers": int(ch["statistics"].get("subscriberCount", 0)) or None,
    }


@mcp.tool()
def get_my_channel_analytics(start_date: str = "", end_date: str = "", by_day: bool = False) -> dict:
    """Private channel analytics for the user's OWN channel (OAuth): views,
    watch time, average view duration/percentage, subscribers gained/lost,
    likes, comments, shares. Defaults to the last 28 days.

    Args:
        start_date: YYYY-MM-DD (default: 28 days before end_date).
        end_date: YYYY-MM-DD (default: today).
        by_day: If true, return a daily time series instead of totals.
    """
    return _aq(
        "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,"
        "subscribersGained,subscribersLost,likes,comments,shares",
        dimensions="day" if by_day else None,
        sort="day" if by_day else None,
        start_date=start_date,
        end_date=end_date,
    )


@mcp.tool()
def get_my_video_analytics(url: str, start_date: str = "", end_date: str = "", by_day: bool = False) -> dict:
    """Private per-video analytics for a video on the user's OWN channel
    (OAuth): views, watch time, average view duration and percentage, likes,
    comments, shares, subscribers gained. Defaults to the last 28 days — pass
    the video's publish date as start_date for lifetime stats.

    Args:
        url: Video URL or ID (must belong to the authenticated channel).
        start_date: YYYY-MM-DD (default: 28 days before end_date).
        end_date: YYYY-MM-DD (default: today).
        by_day: If true, return a daily time series instead of totals.
    """
    vid = extract_video_id(url)
    out = _aq(
        "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,"
        "likes,comments,shares,subscribersGained",
        dimensions="day" if by_day else None,
        filters=f"video=={vid}",
        sort="day" if by_day else None,
        start_date=start_date,
        end_date=end_date,
    )
    out["video_id"] = vid
    return out


@mcp.tool()
def get_my_video_retention(url: str, start_date: str = "2010-01-01", end_date: str = "") -> dict:
    """The REAL retention curve for a video on the user's OWN channel (OAuth):
    audience-watch-ratio across the video's length, plus performance relative
    to similar YouTube videos. Also reports the steepest drop-off points.

    Args:
        url: Video URL or ID (must belong to the authenticated channel).
        start_date: YYYY-MM-DD (default covers the video's lifetime).
        end_date: YYYY-MM-DD (default: today).
    """
    vid = extract_video_id(url)
    out = _aq(
        "audienceWatchRatio,relativeRetentionPerformance",
        dimensions="elapsedVideoTimeRatio",
        filters=f"video=={vid}",
        start_date=start_date,
        end_date=end_date,
    )
    rows = out["rows"]
    drops = []
    for i in range(1, len(rows)):
        prev, cur = rows[i - 1], rows[i]
        delta = (prev.get("audienceWatchRatio") or 0) - (cur.get("audienceWatchRatio") or 0)
        drops.append(
            {
                "at_ratio": cur.get("elapsedVideoTimeRatio"),
                "drop": round(delta, 4),
                "audience_remaining": round(cur.get("audienceWatchRatio") or 0, 4),
            }
        )
    out["video_id"] = vid
    out["steepest_drops"] = sorted(drops, key=lambda d: -d["drop"])[:5]
    out["note"] = (
        "elapsedVideoTimeRatio 0-1 = position in the video; audienceWatchRatio = "
        "fraction of starts still watching; relativeRetentionPerformance vs "
        "similar-length YouTube videos (0.5 = average)."
    )
    return out


@mcp.tool()
def get_my_traffic_sources(url: str = "", start_date: str = "", end_date: str = "") -> dict:
    """Where views come from on the user's OWN channel (OAuth): YouTube Search,
    Suggested, Browse, External, Shorts feed, playlists, etc. Optionally scoped
    to one video. Defaults to the last 28 days.

    Args:
        url: Optional video URL or ID to scope to a single video.
        start_date: YYYY-MM-DD (default: 28 days before end_date).
        end_date: YYYY-MM-DD (default: today).
    """
    filters = f"video=={extract_video_id(url)}" if url.strip() else None
    return _aq(
        "views,estimatedMinutesWatched",
        dimensions="insightTrafficSourceType",
        filters=filters,
        sort="-views",
        start_date=start_date,
        end_date=end_date,
    )


@mcp.tool()
def get_my_audience(start_date: str = "", end_date: str = "") -> dict:
    """Audience demographics for the user's OWN channel (OAuth): age/gender
    split, top countries, and device types. Defaults to the last 28 days.

    Args:
        start_date: YYYY-MM-DD (default: 28 days before end_date).
        end_date: YYYY-MM-DD (default: today).
    """
    demo = _aq(
        "viewerPercentage",
        dimensions="ageGroup,gender",
        sort="-viewerPercentage",
        start_date=start_date,
        end_date=end_date,
    )
    countries = _aq(
        "views", dimensions="country", sort="-views", max_results=10,
        start_date=start_date, end_date=end_date,
    )
    devices = _aq(
        "views", dimensions="deviceType", sort="-views",
        start_date=start_date, end_date=end_date,
    )
    return {
        "start_date": demo["start_date"],
        "end_date": demo["end_date"],
        "age_gender": demo["rows"],
        "top_countries": countries["rows"],
        "devices": devices["rows"],
    }


@mcp.tool()
def get_my_top_videos(start_date: str = "", end_date: str = "", max_results: int = 20) -> dict:
    """Top videos on the user's OWN channel (OAuth) for a period, with private
    metrics: views, watch time, average view percentage, subscribers gained.
    Defaults to the last 28 days.

    Args:
        start_date: YYYY-MM-DD (default: 28 days before end_date).
        end_date: YYYY-MM-DD (default: today).
        max_results: Number of videos (1-200).
    """
    n = max(1, min(int(max_results), 200))
    out = _aq(
        "views,estimatedMinutesWatched,averageViewPercentage,subscribersGained",
        dimensions="video",
        sort="-views",
        max_results=n,
        start_date=start_date,
        end_date=end_date,
    )
    ids = [r["video"] for r in out["rows"] if r.get("video")]
    titles: dict[str, str] = {}
    if ids:
        api = _yt_data_oauth()
        for j in range(0, len(ids), 50):
            resp = api.videos().list(part="snippet", id=",".join(ids[j : j + 50])).execute()
            for it in resp.get("items", []):
                titles[it["id"]] = it["snippet"].get("title")
    for r in out["rows"]:
        r["title"] = titles.get(r.get("video"))
        r["url"] = _watch_url(r.get("video", ""))
    return out


# ---------------------------------------------------------------------------
# Notion tools
# ---------------------------------------------------------------------------

def _notion_headers() -> dict:
    key = os.environ.get("NOTION_API_KEY", "").strip()
    if not key:
        raise ValueError(
            "NOTION_API_KEY is not set. Create an internal integration at "
            "https://www.notion.so/my-integrations, share the target page/database "
            "with it, and set NOTION_API_KEY in the MCP server environment."
        )
    return {
        "Authorization": f"Bearer {key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _notion_request(method: str, path: str, payload: dict | None = None) -> dict:
    import requests

    resp = requests.request(
        method,
        f"https://api.notion.com/v1/{path}",
        headers=_notion_headers(),
        json=payload,
        timeout=30,
    )
    if resp.status_code >= 400:
        raise ValueError(f"Notion API error {resp.status_code}: {resp.text[:500]}")
    return resp.json()


def _rt(text: str | None, limit: int = 1900) -> list[dict]:
    if not text:
        return []
    return [{"type": "text", "text": {"content": text[:limit]}}]


VIDEO_DB_SCHEMA = {
    "Name": {"title": {}},
    "URL": {"url": {}},
    "Video ID": {"rich_text": {}},
    "Channel": {"rich_text": {}},
    "Category": {"select": {}},
    "Topics": {"multi_select": {}},
    "Duration (min)": {"number": {"format": "number"}},
    "Duration Bucket": {
        "select": {
            "options": [
                {"name": "Short (<1 min)"},
                {"name": "1-5 min"},
                {"name": "5-20 min"},
                {"name": "20-60 min"},
                {"name": "60+ min"},
            ]
        }
    },
    "Views": {"number": {}},
    "Views/Day": {"number": {}},
    "Likes": {"number": {}},
    "Likes per 1k Views": {"number": {}},
    "Subscribers": {"number": {}},
    "Views/Subscriber": {"number": {}},
    "Published": {"date": {}},
    "Summary": {"rich_text": {}},
}


@mcp.tool()
def setup_notion_database(parent_page_id: str, title: str = "YouTube Videos") -> dict:
    """Create a Notion database for cataloging YouTube videos, with columns for
    category, topics, duration, views/day, subscriber-normalized performance,
    and summary. Run this ONCE, then set the returned database_id as
    NOTION_DATABASE_ID in the MCP server environment (or pass it to
    add_video_to_notion explicitly).

    Args:
        parent_page_id: The Notion page ID under which to create the database.
            The page must be shared with your Notion integration.
        title: Title for the new database.
    """
    result = _notion_request(
        "POST",
        "databases",
        {
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": title}}],
            "properties": VIDEO_DB_SCHEMA,
        },
    )
    return {
        "database_id": result["id"],
        "database_url": result.get("url"),
        "next_step": "Set NOTION_DATABASE_ID to this database_id in .mcp.json env "
        "(or pass database_id to add_video_to_notion on each call).",
    }


def _thumbnail_url(vid: str) -> str:
    """Best public thumbnail URL for use as a Notion page cover (YouTube
    serves a tiny gray placeholder for qualities that don't exist)."""
    import requests

    for quality in ("maxresdefault", "sddefault", "hqdefault"):
        u = f"https://i.ytimg.com/vi/{vid}/{quality}.jpg"
        try:
            r = requests.head(u, timeout=10)
            if r.status_code == 200 and int(r.headers.get("content-length", "0")) > 2000:
                return u
        except Exception:
            continue
    return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"


@mcp.tool()
def add_video_to_notion(
    url: str,
    category: str,
    topics: list[str] | None = None,
    summary: str = "",
    database_id: str = "",
) -> dict:
    """Add a YouTube video to the Notion catalog database (or update the
    existing entry for that video). Fetches the video's metadata and
    performance stats automatically; you supply the categorization.

    Args:
        url: A YouTube video URL or bare 11-character video ID.
        category: Single category label for the video (e.g. "Tutorial",
            "Review", "Podcast", "News", "Entertainment").
        topics: 2-5 topic tags (e.g. ["AI", "Claude", "coding agents"]).
        summary: One-to-two sentence summary of the video's content.
        database_id: Notion database ID; defaults to the NOTION_DATABASE_ID
            environment variable.
    """
    db = (database_id or os.environ.get("NOTION_DATABASE_ID", "")).strip()
    if not db:
        raise ValueError(
            "No Notion database configured. Run setup_notion_database first, then "
            "set NOTION_DATABASE_ID (or pass database_id explicitly)."
        )

    info = _video_info(extract_video_id(url))
    perf = info.get("performance", {})
    duration_min = (
        round(info["duration_seconds"] / 60, 1) if info.get("duration_seconds") else None
    )
    published = info.get("published_at")
    if published and "T" not in published:
        published_date = published
    elif published:
        published_date = published.split("T")[0]
    else:
        published_date = None

    props: dict = {
        "Name": {"title": _rt(info.get("title") or info["video_id"])},
        "URL": {"url": info["url"]},
        "Video ID": {"rich_text": _rt(info["video_id"])},
        "Channel": {"rich_text": _rt(info.get("channel"))},
        "Category": {"select": {"name": category[:100]}},
        "Topics": {
            "multi_select": [{"name": t[:100]} for t in (topics or [])[:10]]
        },
        "Summary": {"rich_text": _rt(summary)},
    }
    if duration_min is not None:
        props["Duration (min)"] = {"number": duration_min}
    if info.get("duration_bucket"):
        props["Duration Bucket"] = {"select": {"name": info["duration_bucket"]}}
    if info.get("view_count") is not None:
        props["Views"] = {"number": info["view_count"]}
    if perf.get("views_per_day") is not None:
        props["Views/Day"] = {"number": perf["views_per_day"]}
    if info.get("like_count") is not None:
        props["Likes"] = {"number": info["like_count"]}
    if perf.get("likes_per_1000_views") is not None:
        props["Likes per 1k Views"] = {"number": perf["likes_per_1000_views"]}
    if perf.get("channel_subscribers") is not None:
        props["Subscribers"] = {"number": perf["channel_subscribers"]}
    if perf.get("views_to_subscriber_ratio") is not None:
        props["Views/Subscriber"] = {"number": perf["views_to_subscriber_ratio"]}
    if published_date:
        props["Published"] = {"date": {"start": published_date}}

    # thumbnail as page cover so gallery views show visual cards
    cover = {"type": "external", "external": {"url": _thumbnail_url(info["video_id"])}}

    # upsert: match on Video ID to avoid duplicate rows
    existing = _notion_request(
        "POST",
        f"databases/{db}/query",
        {
            "filter": {
                "property": "Video ID",
                "rich_text": {"equals": info["video_id"]},
            }
        },
    )
    results = existing.get("results", [])
    if results:
        page_id = results[0]["id"]
        page = _notion_request(
            "PATCH", f"pages/{page_id}", {"properties": props, "cover": cover}
        )
        action = "updated"
    else:
        page = _notion_request(
            "POST",
            "pages",
            {"parent": {"database_id": db}, "properties": props, "cover": cover},
        )
        action = "created"
    return {
        "action": action,
        "page_id": page["id"],
        "page_url": page.get("url"),
        "video": info.get("title"),
    }


def _md_to_notion_blocks(md: str) -> list[dict]:
    """Convert a practical subset of Markdown (headings, bullets, numbered
    lists, code fences, tables, dividers, paragraphs) into Notion blocks."""
    blocks: list[dict] = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        if s.startswith("```"):
            code: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1  # closing fence
            blocks.append(
                {
                    "object": "block",
                    "type": "code",
                    "code": {"rich_text": _rt("\n".join(code)), "language": "plain text"},
                }
            )
            continue
        if (
            s.startswith("|")
            and i + 1 < len(lines)
            and lines[i + 1].strip().startswith("|")
            and set(lines[i + 1].strip()) <= set("|-: ")
        ):
            rows: list[list[str]] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                rows.append(cells)
                i += 1
            rows = [r for idx, r in enumerate(rows) if idx != 1]  # drop separator row
            width = max(len(r) for r in rows)
            children = [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {
                        "cells": [_rt(r[c]) if c < len(r) else [] for c in range(width)]
                    },
                }
                for r in rows
            ]
            blocks.append(
                {
                    "object": "block",
                    "type": "table",
                    "table": {
                        "table_width": width,
                        "has_column_header": True,
                        "has_row_header": False,
                        "children": children,
                    },
                }
            )
            continue
        if s.startswith("### "):
            blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": _rt(s[4:])}})
        elif s.startswith("## "):
            blocks.append({"object": "block", "type": "heading_2", "heading_2": {"rich_text": _rt(s[3:])}})
        elif s.startswith("# "):
            blocks.append({"object": "block", "type": "heading_1", "heading_1": {"rich_text": _rt(s[2:])}})
        elif s.startswith(("- ", "* ")):
            blocks.append(
                {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": _rt(s[2:])}}
            )
        elif re.match(r"^\d+\.\s", s):
            blocks.append(
                {
                    "object": "block",
                    "type": "numbered_list_item",
                    "numbered_list_item": {"rich_text": _rt(re.sub(r"^\d+\.\s+", "", s))},
                }
            )
        elif s.startswith("---"):
            blocks.append({"object": "block", "type": "divider", "divider": {}})
        else:
            blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rt(s)}})
        i += 1
    return blocks


@mcp.tool()
def save_report_to_notion(title: str, markdown: str, parent_page_id: str = "") -> dict:
    """Save a Markdown report as a new Notion page. Supports headings, bullet
    and numbered lists, tables, code fences, dividers, and paragraphs — tables
    render as real Notion tables.

    Args:
        title: Page title for the report.
        markdown: The full report in Markdown.
        parent_page_id: Notion page under which to create the report; defaults
            to the NOTION_PARENT_PAGE_ID environment variable. The page must be
            shared with your Notion integration.
    """
    parent = (parent_page_id or os.environ.get("NOTION_PARENT_PAGE_ID", "")).strip()
    if not parent:
        raise ValueError(
            "No parent page configured. Pass parent_page_id or set "
            "NOTION_PARENT_PAGE_ID to a Notion page shared with your integration."
        )
    blocks = _md_to_notion_blocks(markdown)
    first, rest = blocks[:90], blocks[90:]
    page = _notion_request(
        "POST",
        "pages",
        {
            "parent": {"type": "page_id", "page_id": parent},
            "properties": {"title": {"title": _rt(title)}},
            "children": first,
        },
    )
    for j in range(0, len(rest), 90):
        _notion_request("PATCH", f"blocks/{page['id']}/children", {"children": rest[j : j + 90]})
    return {"page_id": page["id"], "page_url": page.get("url"), "block_count": len(blocks)}


# ---------------------------------------------------------------------------
# Recommendation ledger — the learning loop.
# Agents log the advice they give, mark it applied/skipped, and record how it
# turned out. Future runs read the ledger first so every recommendation is
# informed by what actually worked on this channel.
# ---------------------------------------------------------------------------

LEDGER_PATH = os.environ.get("YT_LEDGER_PATH", "").strip() or os.path.join(
    PROJECT_ROOT, ".claude", "yt-ledger.jsonl"
)
LEDGER_CATEGORIES = ("packaging", "content", "cadence", "retention", "monetization", "general")
LEDGER_STATUSES = ("open", "applied", "skipped", "resolved")
LEDGER_VERDICTS = ("worked", "failed", "mixed", "unclear")


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ledger_read() -> list[dict]:
    import json

    if not os.path.exists(LEDGER_PATH):
        return []
    entries = []
    with open(LEDGER_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue
    return entries


def _ledger_write(entries: list[dict]) -> None:
    import json

    os.makedirs(os.path.dirname(LEDGER_PATH), exist_ok=True)
    with open(LEDGER_PATH, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


def _video_snapshot(vid: str) -> dict:
    info = _video_info(vid)
    perf = info.get("performance", {})
    return {
        "captured": _utc_now(),
        "title": info.get("title"),
        "views": info.get("view_count"),
        "views_per_day": perf.get("views_per_day"),
        "likes_per_1000_views": perf.get("likes_per_1000_views"),
    }


def _snapshot_delta(baseline: dict, current: dict) -> dict:
    out = {}
    for k in ("views", "views_per_day", "likes_per_1000_views"):
        b, c = baseline.get(k), current.get(k)
        if isinstance(b, (int, float)) and isinstance(c, (int, float)):
            out[k] = {"baseline": b, "now": c, "change": round(c - b, 2)}
    return out


@mcp.tool()
def log_recommendation(
    recommendation: str,
    agent: str = "",
    target: str = "",
    category: str = "general",
    notes: str = "",
) -> dict:
    """Record one recommendation in the learning ledger so future runs can
    check what was advised and whether it worked. A baseline metrics snapshot
    is captured automatically for video targets. Log only the few headline
    recommendations of a report (specific and checkable), not every remark.

    Args:
        recommendation: The specific advice — one per call (e.g. "Retitle to
            'X'", "Make a video answering Y", "Move the hook payoff to 0:15").
        agent: Which agent produced it (e.g. "yt-optimize").
        target: Video URL/ID or channel URL/@handle/ID the advice applies to;
            empty for channel-independent content ideas.
        category: One of "packaging", "content", "cadence", "retention",
            "monetization", "general".
        notes: Optional context — why, and the expected effect.
    """
    if not recommendation.strip():
        raise ValueError("recommendation must not be empty.")
    if category not in LEDGER_CATEGORIES:
        raise ValueError(f"category must be one of {LEDGER_CATEGORIES}.")

    entries = _ledger_read()
    entry: dict = {
        "id": f"rec-{int(_time.time() * 1000)}-{len(entries) + 1:03d}",
        "created": _utc_now(),
        "agent": agent.strip() or "unknown",
        "category": category,
        "recommendation": recommendation.strip(),
        "status": "open",
    }
    if notes.strip():
        entry["notes"] = notes.strip()

    t = target.strip()
    if t:
        vid = None
        try:
            vid = extract_video_id(t)
        except Exception:
            pass
        if vid:
            entry["target_type"] = "video"
            entry["target"] = vid
            try:
                entry["baseline"] = _video_snapshot(vid)
            except Exception as e:
                entry["baseline_error"] = str(e)[:200]
        else:
            entry["target_type"] = "channel"
            entry["target"] = t
            try:
                stats = get_channel_stats(t)
                entry["baseline"] = {
                    "captured": _utc_now(),
                    "subscribers": stats.get("subscribers"),
                    "total_views": stats.get("total_views"),
                    "video_count": stats.get("video_count"),
                }
            except Exception as e:
                entry["baseline_error"] = str(e)[:200]
    else:
        entry["target_type"] = "idea"

    entries.append(entry)
    _ledger_write(entries)
    return {"id": entry["id"], "logged": entry, "ledger_size": len(entries)}


@mcp.tool()
def update_recommendation(
    rec_id: str,
    status: str = "",
    verdict: str = "",
    note: str = "",
    result_url: str = "",
) -> dict:
    """Update a ledger entry: mark it applied/skipped, attach the video that
    resulted from the advice, or record the outcome once results are in.
    Setting a verdict resolves the entry.

    Args:
        rec_id: The id returned by log_recommendation.
        status: New status — "applied", "skipped", or "resolved".
        verdict: Outcome once measurable — "worked", "failed", "mixed",
            "unclear".
        note: What was done, or what the evidence shows.
        result_url: Video created/changed because of the advice; a baseline
            snapshot of it is captured for delta tracking.
    """
    if status and status not in LEDGER_STATUSES:
        raise ValueError(f"status must be one of {LEDGER_STATUSES}.")
    if verdict and verdict not in LEDGER_VERDICTS:
        raise ValueError(f"verdict must be one of {LEDGER_VERDICTS}.")

    entries = _ledger_read()
    entry = next((e for e in entries if e.get("id") == rec_id), None)
    if entry is None:
        raise ValueError(f"No ledger entry with id {rec_id!r}.")

    if status:
        entry["status"] = status
    if verdict:
        entry["verdict"] = verdict
        entry["status"] = "resolved"
        entry["resolved"] = _utc_now()
    if note.strip():
        entry.setdefault("updates", []).append({"at": _utc_now(), "note": note.strip()})
    if result_url.strip():
        vid = extract_video_id(result_url)
        entry["result_video_id"] = vid
        try:
            entry["result_baseline"] = _video_snapshot(vid)
        except Exception as e:
            entry["result_baseline_error"] = str(e)[:200]

    _ledger_write(entries)
    return {"id": rec_id, "entry": entry}


@mcp.tool()
def get_recommendation_ledger(
    status: str = "",
    limit: int = 15,
    refresh_metrics: bool = False,
) -> dict:
    """Read the learning ledger — what was recommended before and how it
    turned out. Call this FIRST when advising a channel that has ledger
    history, and weigh resolved verdicts in the new recommendations.

    Args:
        status: Filter — "open", "applied", "skipped", "resolved"; empty for
            all.
        limit: Max entries returned, newest first.
        refresh_metrics: If true, re-fetch current stats for video targets and
            result videos and include deltas vs the stored baselines.
    """
    entries = _ledger_read()
    counts: dict = {}
    for e in entries:
        counts[e.get("status", "open")] = counts.get(e.get("status", "open"), 0) + 1
        if e.get("verdict"):
            counts[f"verdict:{e['verdict']}"] = counts.get(f"verdict:{e['verdict']}", 0) + 1

    if status:
        entries = [e for e in entries if e.get("status") == status]
    entries = entries[-max(1, limit):][::-1]

    if refresh_metrics:
        for e in entries:
            for base_key, vid_key, out_key in (
                ("baseline", "target", "progress"),
                ("result_baseline", "result_video_id", "result_progress"),
            ):
                base = e.get(base_key)
                if not base or (base_key == "baseline" and e.get("target_type") != "video"):
                    continue
                vid = e.get(vid_key)
                if not vid:
                    continue
                try:
                    e[out_key] = _snapshot_delta(base, _video_snapshot(vid))
                except Exception as err:
                    e[f"{out_key}_error"] = str(err)[:200]

    return {"total": counts, "entries": entries, "ledger_path": LEDGER_PATH}


if __name__ == "__main__":
    mcp.run()  # stdio transport — what Claude Code expects
