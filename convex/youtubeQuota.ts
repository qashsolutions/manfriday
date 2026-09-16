/** YouTube Data API quota arithmetic (compliance rule 7: stay within granted quota).
 *
 * The quota day resets at midnight Pacific time. One videos.insert costs 1,600
 * units; the default project quota is 10,000/day (≈6 uploads across ALL users)
 * until the quota audit clears — then YOUTUBE_DAILY_QUOTA is raised in the
 * Convex dashboard, no code change. Everything here is pure arithmetic so it
 * can run inside mutations and be unit-tested.
 */

export const UPLOAD_UNITS = 1600;
export const DEFAULT_DAILY_LIMIT = 10_000;
const PT = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" });

/** "YYYY-MM-DD" of the Pacific-time quota day containing `ts`. */
export function quotaDay(ts: number): string {
  return fmt.format(new Date(ts));
}

export function quotaKey(ts: number): string {
  return `youtube:${quotaDay(ts)}`;
}

/** [start, end) in ms of the Pacific quota day containing `ts`. */
export function quotaDayBounds(ts: number): { start: number; end: number } {
  const day = quotaDay(ts);
  const [y, m, d] = day.split("-").map(Number);
  // Pacific midnight is 07:00 or 08:00 UTC depending on daylight saving.
  const start = [7, 8].map((h) => Date.UTC(y, m - 1, d, h)).find((c) => quotaDay(c) === day && quotaDay(c - 1) !== day)!;
  const next = [7, 8].map((h) => Date.UTC(y, m - 1, d + 1, h)).find((c) => quotaDay(c) !== day && quotaDay(c - 1) === day)!;
  return { start, end: next };
}

/** First moment of the next quota day, plus a five-minute margin. */
export function nextQuotaDayStart(ts: number): number {
  return quotaDayBounds(ts).end + 5 * 60 * 1000;
}

/** The same wall-clock moment `days` later (DST may shift it by an hour — fine). */
export function shiftDays(ts: number, days: number): number {
  return ts + days * DAY_MS;
}

export function dailyLimit(envValue: string | undefined): number {
  const n = Number(envValue);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}
