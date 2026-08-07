/** The Hook Doctor's grounding pass: where viewers actually left inside the
    first minute of this creator's own recent videos, and which of their
    openings held best.

    Two things make it honest. The floor is arithmetic on numbers already
    stored, so a channel too small to read costs nothing to be honest about —
    not one Analytics call goes out. And a second is only ever named when the
    video's length is known, because a position on a curve without a duration
    is a percentage, not a moment somebody can go and re-watch. */

import { atLabel, fetchRetention, type RetentionPoint } from "./retentionData";
import type { HookExit, HookHold } from "@/lib/hook";

/** Below this many views, "37 of every 100 left at 0:22" is a handful of
    people rather than a pattern — the same reasoning the two-week comparison
    uses before it will call a change real. */
export const MIN_VIEWS_FOR_CURVE = 50;
/** Recent videos considered at all. */
export const RECENT_VIDEOS = 8;
/** Curves actually pulled — one Analytics call each. */
export const MAX_VIDEOS_READ = 6;
/** The window an opening lives in. */
export const FIRST_MINUTE_SECONDS = 60;
/** Where an opening is judged to have held: half a minute in. */
export const HOLD_MARK_SECONDS = 30;
/** Per video. Two real exits explain an opening; five is a transcript. */
export const MAX_EXITS_PER_VIDEO = 2;
/** Two exits inside the same few seconds are one exit. */
const MIN_EXIT_GAP_SECONDS = 5;

export type HookCandidate = {
  ytVideoId: string;
  title: string;
  durationSeconds: number | null;
  views: number | null;
};

export type HookVideoRead = {
  ytVideoId: string;
  title: string;
  views: number;
  exits: HookExit[];
  hold: HookHold | null;
};

export type HookGrounding = {
  /** True only when at least one real exit second was found. Everything the
      product says about grounding hangs off this one boolean. */
  grounded: boolean;
  videos: HookVideoRead[];
  /** How many of their recent videos have enough viewers to read at all. */
  eligible: number;
  /** …and how many were passed over for not having them yet. */
  belowFloor: number;
};

/** The steepest losses inside the first minute, as seconds a creator can go
    and re-watch. Unlike the whole-video read, the very first step counts here:
    viewers gone in the first six seconds are exactly the problem this surface
    exists for. */
export function firstMinuteExits(
  points: RetentionPoint[],
  durationSeconds: number | null,
  videoTitle: string
): HookExit[] {
  if (!durationSeconds || durationSeconds <= 0 || points.length < 2) return [];

  const candidates: HookExit[] = [];
  for (let i = 1; i < points.length; i++) {
    const atSeconds = points[i].x * durationSeconds;
    if (atSeconds > FIRST_MINUTE_SECONDS) break;
    const lost = points[i - 1].watch - points[i].watch;
    if (lost <= 0) continue;
    candidates.push({
      videoTitle,
      label: atLabel(points[i].x, durationSeconds),
      atSeconds: Math.round(atSeconds),
      lostPer100: Math.round(lost * 100),
      stillPer100: Math.round(points[i].watch * 100),
    });
  }

  const picked: HookExit[] = [];
  for (const c of [...candidates].sort((a, b) => b.lostPer100 - a.lostPer100)) {
    if (picked.length >= MAX_EXITS_PER_VIDEO) break;
    if (c.lostPer100 < 1) continue; // a rounding-sized loss is not a moment
    if (picked.every((p) => Math.abs(p.atSeconds - c.atSeconds) >= MIN_EXIT_GAP_SECONDS)) picked.push(c);
  }
  return picked.sort((a, b) => a.atSeconds - b.atSeconds);
}

/** How many were still watching half a minute in — the one number that says
    whether an opening held. Shorter videos are marked at their own end, so the
    label is always a real moment in that video. */
export function holdMark(
  points: RetentionPoint[],
  durationSeconds: number | null,
  videoTitle: string
): HookHold | null {
  if (!durationSeconds || durationSeconds <= 0 || !points.length) return null;
  const mark = Math.min(HOLD_MARK_SECONDS, durationSeconds);
  const targetX = mark / durationSeconds;
  let best = points[0];
  for (const p of points) {
    if (Math.abs(p.x - targetX) < Math.abs(best.x - targetX)) best = p;
  }
  return {
    videoTitle,
    label: atLabel(best.x, durationSeconds),
    heldPer100: Math.round(best.watch * 100),
  };
}

/** Which recent videos have enough viewers for their curve to mean anything.
    Pure, and run before any network call — a channel below the floor is told
    so without a single Analytics request being paid for. */
export function eligibleForCurves(candidates: HookCandidate[]): {
  eligible: HookCandidate[];
  belowFloor: number;
} {
  const recent = candidates.slice(0, RECENT_VIDEOS);
  const eligible = recent.filter(
    (v) => (v.views ?? 0) >= MIN_VIEWS_FOR_CURVE && Boolean(v.durationSeconds)
  );
  return { eligible: eligible.slice(0, MAX_VIDEOS_READ), belowFloor: recent.length - eligible.length };
}

/** The grounding pass itself: curves for the videos that can carry one, folded
    into exit seconds and hold marks. A video whose curve YouTube won't serve
    is simply absent — never a failure, and never filled in with a guess. */
export async function readHookGrounding(
  accessToken: string,
  candidates: HookCandidate[]
): Promise<HookGrounding> {
  const { eligible, belowFloor } = eligibleForCurves(candidates);
  if (!eligible.length) {
    return { grounded: false, videos: [], eligible: 0, belowFloor };
  }

  const curves = await Promise.all(
    eligible.map((v) => fetchRetention(accessToken, v.ytVideoId).catch(() => null))
  );

  const videos: HookVideoRead[] = [];
  eligible.forEach((v, i) => {
    const curve = curves[i];
    if (!curve || curve.points.length < 2) return;
    const exits = firstMinuteExits(curve.points, v.durationSeconds, v.title);
    const hold = holdMark(curve.points, v.durationSeconds, v.title);
    if (!exits.length && !hold) return;
    videos.push({ ytVideoId: v.ytVideoId, title: v.title, views: v.views ?? 0, exits, hold });
  });

  return {
    grounded: videos.some((v) => v.exits.length > 0),
    videos,
    eligible: eligible.length,
    belowFloor,
  };
}

/** The openings that held best, strongest first — the ones worth copying. */
export function bestHeld(g: HookGrounding, max = 3): HookHold[] {
  return g.videos
    .map((v) => v.hold)
    .filter((h): h is HookHold => h !== null)
    .sort((a, b) => b.heldPer100 - a.heldPer100)
    .slice(0, max);
}

/** Every exit second found, in video order then time order. */
export function allExits(g: HookGrounding): HookExit[] {
  return g.videos.flatMap((v) => v.exits);
}
