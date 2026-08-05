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
