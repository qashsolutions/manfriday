/** What the Calendar tells the user about one scheduled/published attempt.
 *
 * Split out of the page so it can be tested: this copy is the only place the
 * product explains that a TikTok post lands as a draft in their inbox (the
 * pre-audit path) rather than going straight to their profile, and that a
 * quota-deferred upload moved by itself.
 */

export type QueueChip = {
  platform: string;
  status: string;
  publishAt: number;
  deferred: boolean;
};

export const STATUS_LABEL: Record<string, string> = {
  queued: "SCHEDULED",
  publishing: "POSTING…",
  live: "LIVE",
  draft_fallback: "DRAFT IN TIKTOK",
  failed: "FAILED",
};

/** One plain sentence: where this went, and what (if anything) the user does. */
export function destination(p: QueueChip, now = Date.now()): string | null {
  const when = new Date(p.publishAt).toLocaleString();
  void now;
  if (p.platform === "tiktok") {
    if (p.status === "draft_fallback")
      return "Waiting in your TikTok app: open TikTok → Inbox → Notifications, tap the draft, then post it. Friday can't publish to TikTok directly until TikTok approves our app.";
    if (p.status === "queued")
      return `Friday sends this to your TikTok inbox at ${when}. You tap post in the TikTok app — direct posting turns on when TikTok approves our app.`;
    if (p.status === "publishing") return "Friday is sending this to your TikTok inbox now.";
  }
  if (p.platform === "youtube") {
    if (p.deferred)
      return `YouTube's upload limit for that day was already used, so Friday moved this to ${when}. Nothing to do — it goes out then.`;
    if (p.status === "queued") return `Friday uploads this to YouTube at ${when}.`;
    if (p.status === "publishing") return "Friday is uploading this to YouTube now.";
    if (p.status === "live") return "Live on your channel. Views land here every morning.";
  }
  return null;
}
