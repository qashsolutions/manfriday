/** When Friday posts a kept video.
 *
 *  The promise is "keep it and it's on your calendar", so the slot has to be
 *  sensible without the user thinking about it: the next 17:30 where *they*
 *  live, one post a day, never in the past. Pure functions so the arithmetic —
 *  time zones, daylight saving, one-per-day spacing — is testable.
 */

export const SUGGESTED_HOUR = 17;
export const SUGGESTED_MINUTE = 30;
const MIN_LEAD_MS = 15 * 60 * 1000; // never schedule something about to fire

/** Milliseconds a zone is ahead of UTC at a given instant (handles DST). */
export function zoneOffsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - at;
}

/** "YYYY-MM-DD" of the local day containing `at` in that zone. */
export function localDayKey(timeZone: string, at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** The UTC instant of a given wall-clock time in a zone. */
export function zonedTimeToUtc(timeZone: string, dayKey: string, hour: number, minute: number): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  const first = naive - zoneOffsetMs(timeZone, naive);
  // One correction pass: the offset may differ at the corrected instant (DST edges).
  return naive - zoneOffsetMs(timeZone, first);
}

/** Add days to a local day key, staying in the zone's calendar. */
export function addLocalDays(timeZone: string, dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return localDayKey(timeZone, Date.UTC(y, m - 1, d + days, 12)); // noon avoids DST edges
}

/**
 * The next free slot: 17:30 local, at least 15 minutes out, on the first day
 * that doesn't already have a post. `taken` holds local day keys already used.
 */
export function nextSlot(timeZone: string, now: number, taken: Iterable<string> = [], horizonDays = 60): number {
  const used = new Set(taken);
  let dayKey = localDayKey(timeZone, now);
  for (let i = 0; i <= horizonDays; i++) {
    if (!used.has(dayKey)) {
      const at = zonedTimeToUtc(timeZone, dayKey, SUGGESTED_HOUR, SUGGESTED_MINUTE);
      if (at > now + MIN_LEAD_MS) return at;
    }
    dayKey = addLocalDays(timeZone, dayKey, 1);
  }
  // Pathological case (everything taken): put it one day past the horizon.
  return zonedTimeToUtc(timeZone, addLocalDays(timeZone, localDayKey(timeZone, now), horizonDays + 1), SUGGESTED_HOUR, SUGGESTED_MINUTE);
}
