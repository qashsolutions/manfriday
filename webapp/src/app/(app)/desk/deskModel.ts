/** The Desk answers exactly three questions a creator has between uploads:
    what just happened, what to do next, and whether the advice is working.
    This file turns the rows the Desk already reads into those three answers —
    pure functions, no I/O, so every state (including the ones a live account
    can never show) is provable in a test.

    Nothing here invents a number or a verdict: every sentence is built from a
    stored row, and where the numbers are too small to mean anything it says so
    instead of guessing. */

import { fmtNum, type Baseline, type ChannelData, type VideoPerf } from "@/lib/channelData";
import type { EvidenceItem } from "@/components/Verdict";
import type { OptionType } from "@/components/OptionCard";
import { TEAM, sentenceCase } from "@/lib/team";

/** A ledger row, exactly as the Ledger screen already reads it. */
export type Rec = {
  id: string;
  created_at: string;
  agent: string;
  category: string;
  recommendation: string;
  notes: string | null;
  status: "open" | "applied" | "skipped" | "resolved";
  verdict: "worked" | "failed" | "mixed" | "unclear" | null;
  target_type: "video" | "channel" | "idea" | null;
  target_yt_id: string | null;
  confidence: number | null;
  evidence: EvidenceItem[] | null;
  option_type: OptionType | null;
  result_snapshot: { metric?: string; before?: number; after?: number; video_title?: string } | null;
  updates: { type: string; at?: string }[] | null;
};

/** A saved analyst read. `data` shapes differ by seat; both are read here for
    the one revelation the Desk shows. */
export type DeskReport = {
  video_id: string | null;
  agent: string;
  created_at: string;
  data: {
    verdict?: string;
    reasons?: { reason: string; evidence: string; agent: string }[];
    drop_reads?: { at: number; label: string; likely_cause: string; fix: string }[];
  } | null;
};

/** The Scorekeeper waits a week of fresh numbers before calling anything. */
export const JUDGE_AFTER_DAYS = 7;

/** Which Desk the reader gets. `unreachable` exists so a failed read can never
    be mistaken for a brand-new account — telling a connected creator to
    connect their channel is the app lying about their own account. */
export type DeskView = "unreachable" | "connect" | "first-read" | "ready";

export function deskView(data: ChannelData): DeskView {
  if (data.failed) return "unreachable";
  if (!data.channel) return "connect";
  if (!data.baselines.longform && !data.baselines.shorts) return "first-read";
  return "ready";
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* ------------------------------------------------------------------ *
 * 1 — What just happened
 * ------------------------------------------------------------------ */

export type Revelation = { provenance: string; text: string };

export type Happened =
  | { kind: "no-video" }
  | {
      kind: "video";
      video: VideoPerf;
      /** The verdict in the creator's words — "Beat your usual." */
      headline: string;
      /** The number, welded to what their normal is and what it points at. */
      line: string;
      tone: "good" | "crit" | "flat";
      href: string;
      actionLabel: string;
      /** The one thing the read revealed that they couldn't see — verbatim. */
      revelation: Revelation | null;
      /** Shown instead when no read exists yet. */
      noRead: string | null;
    };

/** What a video of this format usually gets, in plain words. Null when that
    format has no numbers behind it yet — then nothing is compared. */
function normalFor(v: VideoPerf, baselines: ChannelData["baselines"]): { median: number; what: string } | null {
  const b: Baseline | undefined = v.is_short ? baselines.shorts : baselines.longform;
  if (!b?.median_views) return null;
  return { median: b.median_views, what: v.is_short ? "a Short of yours normally gets" : "a full video of yours normally gets" };
}

/** The newest read on this video, turned into one revelation with its receipt.
    The team's verdict leads (it names the reason and the evidence in one
    breath); the Editor's drop read is the fallback. */
export function revelationFor(videoId: string, reports: DeskReport[]): Revelation | null {
  const mine = reports
    .filter((r) => r.video_id === videoId && r.data)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  for (const r of mine) {
    const reason = r.data?.reasons?.[0];
    if (reason?.reason) {
      return {
        provenance: `${r.agent} · read ${shortDate(r.created_at)}`,
        text: `${reason.reason.replace(/\.$/, "")} — ${reason.evidence}`,
      };
    }
  }
  for (const r of mine) {
    const drop = r.data?.drop_reads?.[0];
    if (drop?.label) {
      return {
        provenance: `${r.agent} · read ${shortDate(r.created_at)}`,
        text: `Viewers left at ${drop.label} — ${drop.likely_cause}`,
      };
    }
  }
  for (const r of mine) {
    if (r.data?.verdict) {
      const first = r.data.verdict.split(/(?<=[.!?])\s/)[0] ?? r.data.verdict;
      return { provenance: `${r.agent} · read ${shortDate(r.created_at)}`, text: first };
    }
  }
  return null;
}

export function whatJustHappened(data: ChannelData, reports: DeskReport[]): Happened {
  const video = [...data.videos].sort(
    (a, b) => Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? "")
  )[0];
  if (!video) return { kind: "no-video" };

  const normal = normalFor(video, data.baselines);
  const views = video.view_count;
  const viewWord = views === 1 ? "view" : "views";
  const href = `/why/${video.id}`;

  let headline: string;
  let line: string;
  let tone: "good" | "crit" | "flat";
  let actionLabel: string;

  if (views === null) {
    headline = "No numbers on this one yet.";
    line =
      "YouTube hasn't reported any views for this upload yet — that usually takes a day. " +
      "The read still works: it shows where viewers stop watching, which is what moves views next time.";
    tone = "flat";
    actionLabel = "See where viewers left";
  } else if (video.flag === "outperformer" && normal) {
    headline = "Beat your usual.";
    line = `${fmtNum(views)} ${viewWord} against the ${fmtNum(normal.median)} ${normal.what} — worth studying so you can do it on purpose.`;
    tone = "good";
    actionLabel = "See what worked";
  } else if (video.flag === "underperformer" && normal) {
    headline = "Fell short.";
    line = `${fmtNum(views)} ${viewWord} against the ${fmtNum(normal.median)} ${normal.what} — the read shows where viewers left, and keeping them longer is what gets YouTube showing it around.`;
    tone = "crit";
    actionLabel = "Find out why";
  } else if (video.flag === "typical" && normal) {
    headline = "About your usual.";
    line = `${fmtNum(views)} ${viewWord} against the ${fmtNum(normal.median)} ${normal.what} — keeping viewers watching longer is what moves that number.`;
    tone = "flat";
    actionLabel = "See where viewers left";
  } else {
    headline = `${fmtNum(views)} ${viewWord} so far — too few to call it.`;
    line =
      "While your videos sit under about 100 views, one extra viewer swings the whole score, " +
      "so the team won't name a win or a miss yet — it starts calling them as your views grow.";
    tone = "flat";
    actionLabel = "See where viewers left";
  }

  const revelation = revelationFor(video.id, reports);
  return {
    kind: "video",
    video,
    headline,
    line,
    tone,
    href,
    actionLabel,
    revelation,
    noRead: revelation
      ? null
      : `No read on this one yet — ${TEAM.editor.name} can show you the second viewers left, and what you were saying when they did.`,
  };
}

/* ------------------------------------------------------------------ *
 * 2 — What to do next
 * ------------------------------------------------------------------ */

export type NextAction = {
  rec: Rec;
  type: OptionType | null;
  /** What doing it costs — derived from what the row targets, never guessed. */
  effort: string;
  /** The screen this action is worked on. */
  href: string;
  hrefLabel: string;
  /** Deep link to where the change is actually made; null when there's
      nothing to edit yet (an idea is a video that doesn't exist). */
  studioUrl: string | null;
  /** What lands on the clipboard — the title itself where the row carries one. */
  copyText: string;
  /** Verbatim evidence, when the row carries it — a receipt never paraphrases. */
  receipt: Revelation | null;
  /** Why this is on the table, when what's stored is reasoning, not evidence. */
  why: string | null;
};

export type NextUp = {
  actions: NextAction[];
  /** Open tips beyond the ones shown — the "not this one?" route. */
  more: number;
};

/** minimal edit · next upload · new video (DESIGN.md §8). Read off what the
    row targets: a live title can be changed now, a video that doesn't exist
    yet can't. */
export function effortFor(rec: Rec): string {
  if (rec.target_type === "idea") return "new video";
  if (rec.category === "packaging") return "minimal edit";
  return "next upload";
}

/** Titles are stored as `Use the title: "…"` — the creator wants the title on
    their clipboard, not the sentence around it. */
export function copyTextFor(rec: Rec): string {
  const quoted = /["“]([^"”]+)["”]/.exec(rec.recommendation);
  return quoted ? quoted[1] : rec.recommendation;
}

/** Studio is offered only where Studio can actually do the job: titles,
    descriptions and thumbnails on a video that's already live. A fix for the
    next upload has nothing to open, and pretending otherwise wastes a click. */
export function studioUrlFor(rec: Rec): string | null {
  if (rec.category !== "packaging") return null;
  return rec.target_yt_id
    ? `https://studio.youtube.com/video/${rec.target_yt_id}/edit`
    : "https://studio.youtube.com/";
}

function destinationFor(rec: Rec, videos: VideoPerf[]): { href: string; hrefLabel: string } {
  if (rec.target_type === "idea") return { href: "/ideas", hrefLabel: "Open your idea list" };
  if (rec.category === "packaging") return { href: "/packaging", hrefLabel: "Work on the title" };
  const v = rec.target_yt_id ? videos.find((x) => x.yt_video_id === rec.target_yt_id) : undefined;
  if (v) return { href: `/why/${v.id}`, hrefLabel: "See the read behind it" };
  return { href: "/ledger", hrefLabel: "Open it in your Ledger" };
}

/** Best-grounded first: the score the analysts built from receipts, then the
    freshest. Only open tips — anything applied has moved on to question 3. */
export function whatToDoNext(recs: Rec[], videos: VideoPerf[], limit = 3): NextUp {
  const open = recs
    .filter((r) => r.status === "open")
    .sort((a, b) =>
      (b.confidence ?? -1) - (a.confidence ?? -1) ||
      Date.parse(b.created_at) - Date.parse(a.created_at)
    );

  const actions: NextAction[] = open.slice(0, limit).map((rec) => {
    const notes = rec.notes?.trim() || null;
    // A receipt is verbatim or nothing (DESIGN.md §6): the Listener's notes
    // quote the viewer who asked; an analyst's expectation is reasoning, and
    // reasoning goes in the "why" line where it belongs.
    const verbatim = notes !== null && /["“”]/.test(notes);
    return {
      rec,
      type: rec.option_type,
      effort: effortFor(rec),
      ...destinationFor(rec, videos),
      studioUrl: studioUrlFor(rec),
      copyText: copyTextFor(rec),
      receipt: verbatim && notes ? { provenance: `${rec.agent} · logged ${shortDate(rec.created_at)}`, text: notes } : null,
      why: verbatim ? null : notes,
    };
  });

  return { actions, more: Math.max(0, open.length - actions.length) };
}

/* ------------------------------------------------------------------ *
 * 3 — Is the advice working
 * ------------------------------------------------------------------ */

export type ScoreChip = { cls: "good" | "warn" | "crit" | "mut"; label: string };

export type ScoreRow = {
  id: string;
  text: string;
  chip: ScoreChip;
  /** The Scorekeeper's before→after pair, when there is one. */
  shift: { before: number; after: number; unit: string } | null;
  measuredOn: string | null;
};

export type Score = {
  lead: string;
  rows: ScoreRow[];
  counts: { worked: number; mixed: number; failed: number; applied: number; open: number };
};

/** Day N of the Scorekeeper's week, counted from when it was marked applied. */
export function appliedDay(rec: Rec, now = Date.now()): number {
  const at = (rec.updates ?? []).find((u) => u.type === "applied")?.at;
  if (!at) return 1;
  return Math.max(1, Math.floor((now - Date.parse(at)) / 86_400_000) + 1);
}

/** Four states, and only four (DESIGN.md §7). "Too early to judge" is neutral:
    honesty about thin numbers is not a warning. */
export function chipFor(rec: Rec, now = Date.now()): ScoreChip {
  if (rec.verdict === "worked") return { cls: "good", label: "✓ worked" };
  if (rec.verdict === "mixed") return { cls: "warn", label: "~ mixed" };
  if (rec.verdict === "failed") return { cls: "crit", label: "✕ didn't work" };
  if (rec.verdict === "unclear") return { cls: "mut", label: "too few views to judge" };
  return {
    cls: "mut",
    label: `too early to judge — day ${Math.min(appliedDay(rec, now), JUDGE_AFTER_DAYS)} of ${JUDGE_AFTER_DAYS}`,
  };
}

export function isTheAdviceWorking(recs: Rec[], limit = 3, now = Date.now()): Score {
  const counts = {
    worked: recs.filter((r) => r.verdict === "worked").length,
    mixed: recs.filter((r) => r.verdict === "mixed").length,
    failed: recs.filter((r) => r.verdict === "failed").length,
    applied: recs.filter((r) => r.status === "applied").length,
    open: recs.filter((r) => r.status === "open").length,
  };

  // Only the verdicts that exist get named — a zero is not a result.
  const called = [
    counts.worked > 0 ? `${counts.worked} worked` : null,
    counts.mixed > 0 ? `${counts.mixed} mixed` : null,
    counts.failed > 0 ? `${counts.failed} didn't` : null,
  ].filter(Boolean).join(" · ");
  const judged = counts.worked + counts.mixed + counts.failed;
  const stillWatched =
    counts.applied > 0 ? ` ${counts.applied} more ${counts.applied === 1 ? "is" : "are"} still being watched.` : "";
  const lead =
    judged > 0
      ? `${called} — measured against your own views, so you know which moves to repeat.${stillWatched}`
      : counts.applied > 0
        ? `${counts.applied} tip${counts.applied === 1 ? "" : "s"} applied and being watched. ${sentenceCase(TEAM.scorekeeper.name)} needs about a week of fresh numbers before calling one, so nothing is graded yet.`
        : "Nothing on the record yet. Mark a tip applied and your views are snapshotted then and there — a week later the Scorekeeper says whether the move paid, misses included.";

  const rows = recs
    .filter((r) => r.status === "applied" || r.status === "resolved")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      text: r.recommendation,
      chip: chipFor(r, now),
      shift:
        r.result_snapshot?.before !== undefined && r.result_snapshot?.after !== undefined
          ? {
              before: r.result_snapshot.before,
              after: r.result_snapshot.after,
              unit: r.result_snapshot.metric === "views_per_day" ? "views a day" : "views",
            }
          : null,
      measuredOn: r.result_snapshot?.video_title ?? null,
    }));

  return { lead, rows, counts };
}
