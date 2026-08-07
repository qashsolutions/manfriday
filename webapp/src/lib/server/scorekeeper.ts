import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRetention, type RetentionPoint } from "./retentionData";
import { accessTokenFromRow, median } from "./youtube";
import { HOLD_MARK_SECONDS, MIN_VIEWS_FOR_CURVE } from "./hookData";

/** The Scorekeeper: checks applied tips against what actually happened.
    No model in the loop — every verdict is arithmetic on the creator's own
    numbers, so it can't be argued with. Runs inside the daily cron.

    THE TAXONOMY (2026-08-07). A verdict now carries the KIND of claim its
    evidence can support, and no surface may render a stronger one:

    - viewers_stayed — measured on the same video's retention curve: the
      window before the change against the window after. Every viewer is a
      data point, so this is the strongest thing the numbers let us say —
      "62 of every 100 now reach 0:30, up from 50" — and it is the one that
      matters, because viewers staying longer is what makes YouTube show a
      video to more people.
    - head_to_head — YouTube's own Test & Compare picked a winner. Platform-
      measured. No API exposes those results (checked against the Analytics
      and Reporting revision histories, 2026-08-07), so THE SCOREKEEPER NEVER
      WRITES THIS KIND. It can only arrive creator-reported, and every
      surface that shows one must say the creator reported it.
    - what_happened — views against the creator's own normal. An observation,
      never a cause: a channel whose videos land anywhere between 40 and
      4,000 views can triple on its own. These notes state the move, the
      swing it sits inside, and what else changed that week — and close with
      "What happened, not why." No causal verb, in either direction.
    - too_early — not enough time or numbers yet. First-class, not filler: a
      tip stays open and is re-checked for four weeks before it is ever
      called too thin to judge.

    The rules:
    - nothing is judged before 7 days of fresh numbers after "I applied this"
    - retention tips on a video try the curve first (viewers_stayed) and fall
      back to views (what_happened) when a window has no curve to read
    - "worked" / "didn't work" must clear the swing the creator's numbers
      already show on their own — 3× on a channel that routinely swings 4×
      is not a result, and the swing only ever raises the bar
    - channel / idea tips: the first upload AFTER applying, at least 5 days
      old, against their normal AS IT STOOD WHEN THEY APPLIED (baselines are
      append-only, so that number is on file)
    - nothing judgeable after 28 days resolves as too_early, said plainly */

const JUDGE_AFTER_DAYS = 7;
const NEW_VIDEO_MIN_AGE_DAYS = 5;
/** How long a tip is watched before "we still can't call this" is the answer. */
const GIVE_UP_AFTER_DAYS = 28;
/** The stretch of life read for the before-curve. */
const RETENTION_BEFORE_DAYS = 14;
/** Percentage points at the mark that count as viewers really staying longer.
    Under this the curve moved the way curves move. */
const HELD_POINTS_REAL = 3;

const DAY = 86_400_000;

/** What kind of claim a verdict is allowed to make. Mirrors the
    `recommendations.verdict_kind` check constraint (migration 17). */
export type VerdictKind = "viewers_stayed" | "head_to_head" | "what_happened" | "too_early";
export const VERDICT_KINDS: readonly VerdictKind[] = [
  "viewers_stayed",
  "head_to_head",
  "what_happened",
  "too_early",
];

type Verdict = "worked" | "failed" | "mixed" | "unclear";

type Rec = {
  id: string;
  category: string;
  target_type: "video" | "channel" | "idea";
  target_yt_id: string | null;
  baseline: { views_per_day?: number | null; view_count?: number | null } | null;
  updates: { type: string; at?: string }[] | null;
  updated_at: string;
};

type Judgement = { kind: VerdictKind; verdict: Verdict; result: Record<string, unknown> };

type BaselineRow = {
  format: string;
  median_views: number | null;
  sample_size: number | null;
  computed_at: string;
  videos: { view_count: number | null }[] | null;
};

type Upload = {
  id: string;
  yt_video_id: string;
  title: string | null;
  published_at: string | null;
  is_short: boolean | null;
};

/** The range a set of numbers actually spans, around their middle. Fewer than
    five numbers is not a range, it's noise — and a swing we can't describe is
    one we don't claim. */
export function spread(values: (number | null | undefined)[]): { low: number; high: number; mid: number } | null {
  const v = values
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (v.length < 5) return null;
  const mid = median(v);
  if (!mid) return null;
  return { low: v[0], high: v[v.length - 1], mid };
}

/** Which way the numbers moved — and the swing they had to clear to say so.
    The creator's own spread only ever RAISES the bar: a move inside the
    bounce their numbers already show on their own is not a result. */
export function direction(ratio: number, swing: { low: number; high: number; mid: number } | null): Verdict {
  const up = Math.max(1.5, swing ? swing.high / swing.mid : 0);
  const down = Math.min(0.75, swing ? swing.low / swing.mid : 1);
  if (ratio >= up) return "worked";
  if (ratio <= down) return "failed";
  return "mixed";
}

/** Where an opening is judged to have held: half a minute in for a full
    video, halfway through for a Short — a mark the creator can go and
    re-watch either way. */
export function holdMark(durationSeconds: number | null): { x: number; label: string } {
  if (durationSeconds && durationSeconds > HOLD_MARK_SECONDS * 2) {
    return { x: HOLD_MARK_SECONDS / durationSeconds, label: "0:30" };
  }
  if (durationSeconds) {
    const s = Math.round(durationSeconds / 2);
    return { x: 0.5, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
  }
  return { x: 0.5, label: "halfway" };
}

/** Of every 100 viewers who started, how many were still there at the mark. */
export function heldAt(points: RetentionPoint[], x: number): number | null {
  if (points.length < 5) return null;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  let held: number | null = null;
  for (const p of sorted) {
    if (p.x <= x) held = p.watch;
    else break;
  }
  if (held === null) held = sorted[0].watch;
  // Re-watching can push the curve above everyone-who-started; "of every 100
  // viewers" is the sentence this feeds, so it stops at 100.
  return Math.min(100, Math.round(Math.max(0, held) * 100));
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/** The sentence the Scorekeeper is willing to defend on a views-only move.
    States what moved, the swing it sits inside, and what else changed — then
    stops. No causal verb, in either direction: the closing stamp is the
    whole point of this kind. */
function whatHappenedClaim(parts: { move: string; swing: string | null; company: string[] }): string {
  const company = parts.company.length
    ? ` Also that week: ${parts.company.join("; ")}.`
    : "";
  return `${parts.move}${parts.swing ? ` ${parts.swing}` : ""}${company} What happened, not why.`;
}

/** Too early is a real answer, and it gets said the same way every time. */
function tooEarlyClaim(reason: string): string {
  return (
    `Still too thin to judge — most changes are at this point. ` +
    `YouTube's own title and thumbnail tests run up to two weeks before they call a winner, ` +
    `and after four weeks of watching, ${reason}. Nothing goes on your record that the numbers can't back.`
  );
}

const dayStamp = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function appliedAtOf(rec: Rec): number | null {
  const at = (rec.updates ?? []).find((u) => u.type === "applied")?.at ?? rec.updated_at;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/** The normal as it stood when they applied the tip — not today's, which a
    new upload has already moved. Baselines are append-only, so the number
    they were actually advised against is on file. */
function normalAt(rows: BaselineRow[], format: string, atMs: number): BaselineRow | null {
  const ofFormat = rows
    .filter((b) => b.format === format)
    .sort((a, b) => Date.parse(a.computed_at) - Date.parse(b.computed_at));
  const onOrBefore = ofFormat.filter((b) => Date.parse(b.computed_at) <= atMs);
  // Nothing on file from back then — the nearest read after it is the closest
  // thing to the number they were actually advised against.
  return onOrBefore.at(-1) ?? ofFormat[0] ?? null;
}

export async function checkAppliedTips(
  svc: SupabaseClient,
  userId: string,
  /** The cron already holds a token for this user; pass it to save a refresh.
      Left out, the Scorekeeper fetches its own — and only when a curve is
      actually worth reading. */
  access?: string
): Promise<number> {
  const { data: recs } = await svc
    .from("recommendations")
    .select("id,category,target_type,target_yt_id,baseline,updates,updated_at")
    .eq("user_id", userId)
    .eq("status", "applied");
  if (!recs || recs.length === 0) return 0;

  const now = Date.now();
  const due = (recs as Rec[])
    .map((rec) => ({ rec, appliedAt: appliedAtOf(rec) }))
    .filter((d): d is { rec: Rec; appliedAt: number } => d.appliedAt !== null && now - d.appliedAt >= JUDGE_AFTER_DAYS * DAY);
  if (due.length === 0) return 0;

  // What else moved while these tips were being watched — the company every
  // what-happened note keeps. One read for the whole run.
  const uploadsSince = new Date(now - (GIVE_UP_AFTER_DAYS + NEW_VIDEO_MIN_AGE_DAYS) * DAY).toISOString();
  const { data: uploadRows } = await svc
    .from("videos")
    .select("id,yt_video_id,title,published_at,is_short")
    .eq("user_id", userId)
    .gt("published_at", uploadsSince)
    .order("published_at", { ascending: true });
  const uploads = (uploadRows ?? []) as Upload[];

  const { data: blRows } = await svc
    .from("channel_baselines")
    .select("format,median_views,sample_size,videos,computed_at")
    .eq("user_id", userId)
    .order("computed_at", { ascending: false })
    .limit(40);
  const baselines = (blRows ?? []) as BaselineRow[];

  // Looked up once, and only if a curve is worth reading.
  let token: string | null | undefined = access;
  const accessOnce = async (): Promise<string | null> => {
    if (token !== undefined) return token;
    token = null;
    const { data: row } = await svc
      .from("google_oauth_tokens")
      .select("refresh_token_ciphertext")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (!row) return token;
    try {
      token = await accessTokenFromRow(row.refresh_token_ciphertext as unknown as string);
    } catch {
      token = null;
    }
    return token;
  };

  /** Everything else that moved in the same week, from stored rows only —
      the company a views-only observation is never reported without. */
  const companyFor = (recId: string, appliedAt: number, exceptYtId: string | null): string[] => {
    const lines: string[] = [];
    const published = uploads.filter((u) => {
      const at = u.published_at ? Date.parse(u.published_at) : NaN;
      return Number.isFinite(at) && at >= appliedAt && u.yt_video_id !== exceptYtId;
    });
    if (published.length === 1) lines.push(`you published "${published[0].title ?? published[0].yt_video_id}"`);
    else if (published.length > 1) lines.push(`you published ${published.length} more videos`);
    const others = due.filter(
      (d) => d.rec.id !== recId && Math.abs(d.appliedAt - appliedAt) <= JUDGE_AFTER_DAYS * DAY
    ).length;
    if (others > 0) lines.push(`you applied ${others} other ${others === 1 ? "tip" : "tips"}`);
    return lines;
  };

  let resolved = 0;

  for (const { rec, appliedAt } of due) {
    let judged: Judgement | null = null;
    let reason = "the numbers never got thick enough to call it";

    if (rec.target_type === "video" && rec.target_yt_id) {
      const { data: video } = await svc
        .from("videos")
        .select("id,title,duration_seconds")
        .eq("user_id", userId)
        .eq("yt_video_id", rec.target_yt_id)
        .maybeSingle();

      if (!video) {
        reason = "this video is no longer in your library, so there is nothing left to measure";
      } else {
        const { data: snapRows } = await svc
          .from("video_snapshots")
          .select("views_per_day,view_count,captured_at")
          .eq("video_id", video.id)
          .order("captured_at", { ascending: false })
          .limit(60);
        const snaps = (snapRows ?? []) as { views_per_day: number | null; view_count: number | null; captured_at: string }[];
        const latest = snaps[0] ?? null;

        // 1. The strongest read available: did viewers actually stay longer?
        if (rec.category === "retention" && (latest?.view_count ?? 0) >= MIN_VIEWS_FOR_CURVE) {
          const at = await accessOnce();
          if (at) {
            const mark = holdMark((video.duration_seconds as number | null) ?? null);
            const [beforeCurve, afterCurve] = await Promise.all([
              fetchRetention(at, rec.target_yt_id, {
                startDate: dayStamp(appliedAt - RETENTION_BEFORE_DAYS * DAY),
                endDate: dayStamp(appliedAt - DAY),
              }).catch(() => null),
              fetchRetention(at, rec.target_yt_id, {
                startDate: dayStamp(appliedAt + DAY),
                endDate: dayStamp(now),
              }).catch(() => null),
            ]);
            const heldBefore = beforeCurve ? heldAt(beforeCurve.points, mark.x) : null;
            const heldAfter = afterCurve ? heldAt(afterCurve.points, mark.x) : null;
            if (heldBefore !== null && heldAfter !== null) {
              const points = heldAfter - heldBefore;
              const verdict: Verdict =
                points >= HELD_POINTS_REAL ? "worked" : points <= -HELD_POINTS_REAL ? "failed" : "mixed";
              const claim =
                verdict === "worked"
                  ? `Viewers stay longer now: ${heldAfter} of every 100 reach ${mark.label}, up from ${heldBefore} before the change — that is the signal YouTube reads before showing a video to more people. Worth doing on the videos that still lose people early.`
                  : verdict === "failed"
                    ? `Viewers leave sooner now: ${heldAfter} of every 100 reach ${mark.label}, down from ${heldBefore} before the change — worth putting the old opening back, or trying a different one.`
                    : `How long viewers stay barely moved: ${heldAfter} of every 100 reach ${mark.label}, against ${heldBefore} before — the change was too small to feel, so the next one has to be bigger.`;
              judged = {
                kind: "viewers_stayed",
                verdict,
                result: {
                  measured: "retention",
                  claim,
                  mark: mark.label,
                  held_before: heldBefore,
                  held_after: heldAfter,
                  held_points: points,
                  video_title: video.title,
                  yt_video_id: rec.target_yt_id,
                },
              };
            }
          }
        }

        // 2. Views only: an observation about this video, never a cause.
        const before = rec.baseline?.views_per_day ?? null;
        const after = latest?.views_per_day ?? null;
        if (!judged && before !== null && before > 0 && after !== null) {
          const ratio = Math.round((after / before) * 100) / 100;
          // This video's own bounce in the fortnight before anything changed —
          // the yardstick a single-video move has to clear.
          const bounce = spread(
            snaps
              .filter((s) => {
                const at = Date.parse(s.captured_at);
                return at < appliedAt && at >= appliedAt - RETENTION_BEFORE_DAYS * DAY;
              })
              .map((s) => s.views_per_day)
          );
          const verdict = direction(ratio, bounce);
          const company = companyFor(rec.id, appliedAt, rec.target_yt_id);
          const claim = whatHappenedClaim({
            move: `Views went ${fmt(before)} a day → ${fmt(after)} a day after this change.`,
            swing: bounce
              ? `This video's own views a day already bounced between ${fmt(bounce.low)} and ${fmt(bounce.high)} in the fortnight before you touched it, so the move sits ${after >= bounce.high || after <= bounce.low ? "outside" : "inside"} that bounce.`
              : null,
            company,
          });
          judged = {
            kind: "what_happened",
            verdict,
            result: {
              measured: "views",
              claim,
              metric: "views_per_day",
              before,
              after,
              ratio,
              video_title: video.title,
              yt_video_id: rec.target_yt_id,
              swing: bounce ? { low: bounce.low, high: bounce.high } : null,
              what_else_changed: company,
            },
          };
        } else if (!judged && (before === null || before <= 0)) {
          reason = "no before-number was captured with this tip, so there is nothing to compare against";
        } else if (!judged) {
          reason = "no fresh numbers have come back for this video";
        }
      }
    } else {
      // Channel / idea tips: the first upload after applying, against the
      // normal as it stood then.
      const nv = uploads.find((u) => {
        const at = u.published_at ? Date.parse(u.published_at) : NaN;
        return Number.isFinite(at) && at > appliedAt;
      });
      if (!nv) {
        reason = "you haven't published anything since, so there is nothing to measure it on";
      } else if (now - Date.parse(nv.published_at as string) < NEW_VIDEO_MIN_AGE_DAYS * DAY) {
        continue; // the new video is still too fresh — keep watching
      } else {
        const fmtKey = nv.is_short ? "shorts" : "longform";
        const bl = normalAt(baselines, fmtKey, appliedAt);
        const { data: snapRows } = await svc
          .from("video_snapshots")
          .select("view_count")
          .eq("video_id", nv.id)
          .order("captured_at", { ascending: false })
          .limit(1);
        const views = (snapRows ?? [])[0]?.view_count ?? null;
        const usual = bl?.median_views ?? null;
        if (!usual || usual <= 0 || views === null) {
          reason = "your normal for this format is still too thin to measure a new video against";
        } else {
          const ratio = Math.round((views / usual) * 100) / 100;
          const swing = spread((bl?.videos ?? []).map((v) => v.view_count));
          const verdict = direction(ratio, swing);
          const company = companyFor(rec.id, appliedAt, nv.yt_video_id);
          const claim = whatHappenedClaim({
            move: `"${nv.title ?? nv.yt_video_id}" has ${fmt(views)} views. Your usual is about ${fmt(usual)}.`,
            swing: swing
              ? `Your videos land anywhere between ${fmt(swing.low)} and ${fmt(swing.high)} views, so this one sits ${views >= swing.high || views <= swing.low ? "outside" : "inside"} your normal range.`
              : null,
            company,
          });
          judged = {
            kind: "what_happened",
            verdict,
            result: {
              measured: "views",
              claim,
              metric: "views_vs_normal",
              before: usual,
              after: views,
              ratio,
              video_title: nv.title,
              yt_video_id: nv.yt_video_id,
              normal_from: bl?.computed_at ?? null,
              swing: swing ? { low: swing.low, high: swing.high } : null,
              what_else_changed: company,
            },
          };
        }
      }
    }

    // Nothing to say yet: keep watching, and only after four weeks say so.
    if (!judged) {
      if (now - appliedAt < GIVE_UP_AFTER_DAYS * DAY) continue;
      judged = {
        kind: "too_early",
        verdict: "unclear",
        result: { measured: "none", claim: tooEarlyClaim(reason), reason },
      };
    }

    const nowIso = new Date().toISOString();
    await svc
      .from("recommendations")
      .update({
        status: "resolved",
        verdict: judged.verdict,
        verdict_kind: judged.kind,
        resolved_at: nowIso,
        result_snapshot: judged.result,
        updates: [...(rec.updates ?? []), { type: "verdict", at: nowIso, verdict: judged.verdict, kind: judged.kind }],
      })
      .eq("id", rec.id);
    resolved++;
  }

  return resolved;
}
