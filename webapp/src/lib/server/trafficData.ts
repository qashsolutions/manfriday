/** Per-video traffic sources from YouTube Analytics (the user's own channel,
    existing read-only scope): where the views actually came from — the
    strongest honest evidence for WHY a video got the views it got. */

export type TrafficSource = { type: string; views: number };
export type SearchTerm = { term: string; views: number };

const today = () => new Date().toISOString().slice(0, 10);

export async function fetchTrafficSources(
  accessToken: string,
  ytVideoId: string
): Promise<{ sources: TrafficSource[]; searchTerms: SearchTerm[] }> {
  const base = "https://youtubeanalytics.googleapis.com/v2/reports";
  const out: { sources: TrafficSource[]; searchTerms: SearchTerm[] } = { sources: [], searchTerms: [] };
  try {
    const res = await fetch(
      `${base}?ids=channel%3D%3DMINE&startDate=2000-01-01&endDate=${today()}` +
        `&metrics=views&dimensions=insightTrafficSourceType&sort=-views` +
        `&filters=video%3D%3D${encodeURIComponent(ytVideoId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (res.ok) {
      const j = await res.json();
      out.sources = ((j.rows ?? []) as [string, number][]).map(([type, views]) => ({ type, views }));
    }
  } catch { /* absent is fine — the analyst says so honestly */ }
  try {
    const res = await fetch(
      `${base}?ids=channel%3D%3DMINE&startDate=2000-01-01&endDate=${today()}` +
        `&metrics=views&dimensions=insightTrafficSourceDetail&sort=-views&maxResults=10` +
        `&filters=video%3D%3D${encodeURIComponent(ytVideoId)}%3BinsightTrafficSourceType%3D%3DYT_SEARCH`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (res.ok) {
      const j = await res.json();
      out.searchTerms = ((j.rows ?? []) as [string, number][]).map(([term, views]) => ({ term, views }));
    }
  } catch { /* ditto */ }
  return out;
}

/* ── The distribution read ─────────────────────────────────────────────────
   Everything below is additive: the same Analytics report, asked twice over
   two named weeks, so "views fell" can be answered with WHICH way in became
   smaller. Every constant is derived from something YouTube or this product
   already states — none is picked because it looks tidy. */

/** Each side of the comparison is one week. */
export const WINDOW_DAYS = 7;
/** YouTube's own numbers for the last couple of days are still filling in. */
export const DATA_LAG_DAYS = 2;
/** Both weeks must sit entirely after the video went up and behind the lag,
    so a video younger than this cannot yet be compared with itself. */
export const MIN_AGE_DAYS = DATA_LAG_DAYS + WINDOW_DAYS * 2 - 1;
/** Under this many views across the two weeks, a "70% fall" is four views
    instead of twelve — a number nobody can act on. */
export const MIN_COMPARE_VIEWS = 50;
/** A video's numbers commonly settle over one to two weeks, so a change made
    today is worth checking back on two weeks from today. */
export const CHECK_BY_DAYS = 14;

/** Every traffic-source type YouTube names, in words a creator uses. Anything
    unnamed says so rather than guessing (verified against
    developers.google.com/youtube/analytics/dimensions, 2026-08-07). */
const SOURCE_LABELS: Record<string, string> = {
  YT_SEARCH: "people searched YouTube and found it",
  RELATED_VIDEO: "YouTube suggested it beside another video",
  SUBSCRIBER: "YouTube's home page and subscription feeds",
  NOTIFICATION: "subscribers got a notification",
  EXT_URL: "a link shared off YouTube",
  SHORTS: "people swiped to it in the Shorts feed",
  PLAYLIST: "it played as part of a playlist",
  YT_CHANNEL: "someone browsing your channel page",
  END_SCREEN: "the end screen of another video",
  HASHTAGS: "a hashtag page",
  SOUND_PAGE: "a Shorts sound page",
  VIDEO_REMIXES: "a remix link in the Shorts player",
  YT_OTHER_PAGE: "another page on YouTube",
  NO_LINK_EMBEDDED: "it was embedded on a website",
  NO_LINK_OTHER: "YouTube couldn't tell where they came from",
  ADVERTISING: "an ad",
  PROMOTED: "an unpaid YouTube promotion",
  ANNOTATION: "a clickable note in another video",
  CAMPAIGN_CARD: "a promotion card on another video",
  LIVE_REDIRECT: "a live redirect",
  PRODUCT_PAGE: "a product page",
  WATCH_WITH: "a Watch With stream",
};

/** The creator-facing name for one traffic-source type. Never returns the raw
    type: a screen must not be able to print YT_SEARCH at anybody. */
export function plainSource(type: string): string {
  return SOURCE_LABELS[type] ?? "somewhere YouTube didn't name";
}

/** The four ways in, as a creator experiences them. The split that matters is
    `feed` (all algorithm) against `followers` (no algorithm) — that pair is
    the control test: if the people who already follow you kept showing up
    while the feed dried out, the video didn't change, the distribution did. */
export type BucketKey = "feed" | "search" | "followers" | "links";

export const BUCKET_LABEL: Record<BucketKey, string> = {
  feed: "YouTube putting it in front of people",
  search: "people searching for it",
  followers: "people who already follow you",
  links: "links, embeds and anywhere else",
};

const TYPE_BUCKET: Record<string, BucketKey> = {
  YT_SEARCH: "search",
  RELATED_VIDEO: "feed", SHORTS: "feed", HASHTAGS: "feed", SOUND_PAGE: "feed",
  VIDEO_REMIXES: "feed", END_SCREEN: "feed", YT_OTHER_PAGE: "feed", PLAYLIST: "feed",
  SUBSCRIBER: "followers", NOTIFICATION: "followers", YT_CHANNEL: "followers",
  EXT_URL: "links", NO_LINK_OTHER: "links", NO_LINK_EMBEDDED: "links",
  ADVERTISING: "links", PROMOTED: "links", ANNOTATION: "links",
  CAMPAIGN_CARD: "links", LIVE_REDIRECT: "links", PRODUCT_PAGE: "links",
  WATCH_WITH: "links",
};

/** YouTube files home-page views and Subscriptions-feed views under one type
    (SUBSCRIBER); only the detail dimension tells them apart. These are the
    detail values that mean "someone who already follows you came back". */
const SUBS_FEED_DETAIL = new Set(["/my_subscriptions", "activity", "sdig", "uploaded", "mychannel", "podcasts", "blogged"]);
/** …and this is the home page, which is the algorithm. */
const HOME_FEED_DETAIL = new Set(["/"]);

export type TrafficDetail = { detail: string; views: number };

export type TrafficWindow = {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  sources: TrafficSource[];
  /** SUBSCRIBER split by feed — the only way to separate the no-algorithm
      channel from the home page. Empty when YouTube reports no detail. */
  subscriberDetail: TrafficDetail[];
};

export type Buckets = {
  feed: number;
  search: number;
  followers: number;
  links: number;
  total: number;
  /** True when YouTube's detail rows accounted for essentially all of the
      home-page/subscriptions pile. False means `followers` still contains
      home-page views and the control test must not be stated as if it were
      clean. */
  splitKnown: boolean;
};

/** Folds one window's raw rows into the four ways in. Pure — the numbers a
    screen shows and an analyst reasons over come from here, not from prose. */
export function bucketTraffic(w: { sources: TrafficSource[]; subscriberDetail: TrafficDetail[] }): Buckets {
  const out: Buckets = { feed: 0, search: 0, followers: 0, links: 0, total: 0, splitKnown: false };
  let subscriberTotal = 0;
  for (const s of w.sources) {
    out.total += s.views;
    if (s.type === "SUBSCRIBER") { subscriberTotal += s.views; continue; }
    out[TYPE_BUCKET[s.type] ?? "links"] += s.views;
  }
  if (subscriberTotal === 0) {
    // Nothing to split: whatever the detail rows say, the pile is empty.
    out.splitKnown = true;
    return out;
  }

  let subs = 0;
  let home = 0;
  for (const d of w.subscriberDetail) {
    if (SUBS_FEED_DETAIL.has(d.detail)) subs += d.views;
    else if (HOME_FEED_DETAIL.has(d.detail)) home += d.views;
  }
  const accounted = subs + home;
  // 90%: YouTube rounds and buckets small tails, so demanding every view be
  // named would throw away a split that is plainly good enough to reason on.
  out.splitKnown = accounted >= subscriberTotal * 0.9;
  if (out.splitKnown) {
    out.followers += subs;
    out.feed += home + (subscriberTotal - accounted);
  } else {
    // Unknown split: keep the pile whole on the followers side and let the
    // caller say plainly that home-page views are mixed in. Filing it under
    // the feed instead would manufacture a distribution story.
    out.followers += subscriberTotal;
  }
  return out;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const minusDays = (d: Date, days: number) => new Date(d.getTime() - days * 86_400_000);

/** The two weeks being compared: the most recent complete one YouTube has
    finished counting, and the one before it. */
export function windowsFor(now: Date): { recent: { from: string; to: string }; prior: { from: string; to: string } } {
  const recentTo = minusDays(now, DATA_LAG_DAYS);
  const recentFrom = minusDays(recentTo, WINDOW_DAYS - 1);
  const priorTo = minusDays(recentFrom, 1);
  const priorFrom = minusDays(priorTo, WINDOW_DAYS - 1);
  return {
    recent: { from: isoDay(recentFrom), to: isoDay(recentTo) },
    prior: { from: isoDay(priorFrom), to: isoDay(priorTo) },
  };
}

/** The floor, decided by arithmetic rather than by asking a model to be
    honest: below it there is nothing to diagnose and the screen says so. */
export type DistributionFloor =
  | { kind: "too_new"; ageDays: number }
  | { kind: "too_quiet"; views: number }
  | null;

export function distributionFloor(a: {
  publishedAt: string | null;
  comparedViews: number;
  now: Date;
}): DistributionFloor {
  const published = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
  if (!Number.isNaN(published)) {
    const ageDays = Math.floor((a.now.getTime() - published) / 86_400_000);
    if (ageDays < MIN_AGE_DAYS) return { kind: "too_new", ageDays: Math.max(0, ageDays) };
  }
  if (a.comparedViews < MIN_COMPARE_VIEWS) return { kind: "too_quiet", views: a.comparedViews };
  return null;
}

/** The date a pick made today is worth checking back on. */
export function checkByDate(now: Date): string {
  return isoDay(new Date(now.getTime() + CHECK_BY_DAYS * 86_400_000));
}

const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

async function reportRows(url: string, accessToken: string): Promise<[string, number][]> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.rows ?? []) as [string, number][];
  } catch {
    return []; // absent is fine — the floor and the analyst both say so honestly
  }
}

/** The same per-video traffic report as above, asked over two named weeks so
    the change between them is a fact rather than a feeling. Four reads, all
    in parallel: source types and the subscriptions/home split, per window. */
export async function fetchTrafficWindows(
  accessToken: string,
  ytVideoId: string,
  now: Date = new Date()
): Promise<{ recent: TrafficWindow; prior: TrafficWindow }> {
  const spans = windowsFor(now);
  const video = encodeURIComponent(ytVideoId);

  const oneWindow = async (span: { from: string; to: string }): Promise<TrafficWindow> => {
    const range = `ids=channel%3D%3DMINE&startDate=${span.from}&endDate=${span.to}&metrics=views`;
    const [sources, detail] = await Promise.all([
      reportRows(`${ANALYTICS}?${range}&dimensions=insightTrafficSourceType&sort=-views&filters=video%3D%3D${video}`, accessToken),
      reportRows(
        `${ANALYTICS}?${range}&dimensions=insightTrafficSourceDetail&sort=-views&maxResults=10` +
          `&filters=video%3D%3D${video}%3BinsightTrafficSourceType%3D%3DSUBSCRIBER`,
        accessToken
      ),
    ]);
    return {
      from: span.from,
      to: span.to,
      sources: sources.map(([type, views]) => ({ type, views })),
      subscriberDetail: detail.map(([d, views]) => ({ detail: d, views })),
    };
  };

  const [recent, prior] = await Promise.all([oneWindow(spans.recent), oneWindow(spans.prior)]);
  return { recent, prior };
}

/** Plain-English legend the analyst uses to talk about traffic types. */
export const TRAFFIC_LEGEND = `
Traffic-source types, in plain words:
BROWSE_FEATURES / SUBSCRIBER = YouTube showed it on Home or the Subscriptions feed
RELATED_VIDEO = suggested next to other videos
YT_SEARCH = people searched and found it
EXT_URL = links from outside YouTube (WhatsApp, sites)
NOTIFICATION = subscribers were notified
PLAYLIST / YT_CHANNEL = found via a playlist or the channel page
SHORTS = the Shorts feed
NO_LINK_OTHER / NO_LINK_EMBEDDED = direct opens or embeds
`.trim();
