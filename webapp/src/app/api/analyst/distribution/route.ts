import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import {
  BUCKET_LABEL, MIN_AGE_DAYS, WINDOW_DAYS,
  bucketTraffic, checkByDate, distributionFloor, fetchTrafficSources, fetchTrafficWindows,
  plainSource, windowsFor,
  type BucketKey, type Buckets,
} from "@/lib/server/trafficData";
import { analystJsonStream, analystStream, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";
import { TEAM_ATTRIBUTION, sentenceCase } from "@/lib/team";

export const maxDuration = 120;

/** The distribution read: how viewers found this video, and — when the way in
    changed — whether that was the video or the way YouTube spread it.

    The floor is arithmetic, not a request for honesty: below it this route
    never calls the model at all, so "too early to judge" cannot be padded into
    a verdict by something that wants to be helpful. Above it, the verdict
    arrives with its numbers in the same sentence, and the response options are
    typed choices the creator picks from — never one order. */

type Evidence = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };

type ResponseOption = {
  type: "safe" | "reach" | "bold";
  effort: "minimal edit" | "re-cut" | "format change" | "next upload" | "new video";
  text: string;
  category: "packaging" | "content" | "retention";
  why: string;
  confidence: number;
  evidence: Evidence[];
};

type Distribution = {
  state: "you" | "distribution" | "steady" | "too_early";
  verdict: string;
  where_from: string;
  what_changed: string | null;
  control_test: string | null;
  steady_note: string | null;
  options: ResponseOption[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["state", "verdict", "where_from", "what_changed", "control_test", "steady_note", "options"],
  properties: {
    state: {
      type: "string",
      enum: ["you", "distribution", "steady", "too_early"],
      description:
        "The one-word answer. 'you' = the video is the bigger cause (both ways in fell together, or nothing " +
        "about the distribution changed). 'distribution' = how YouTube spread it is the bigger cause (the feed " +
        "fell while the people who already follow them held). 'steady' = nothing moved enough to call, and " +
        "saying so is the service. 'too_early' = even with enough views to read, these numbers can't separate " +
        "the two — say what would settle it.",
    },
    verdict: {
      type: "string",
      description:
        "The answer, opening with '**In short** — ' and then 2-3 plain-English sentences. The numbers that " +
        "prove it sit in the SAME sentence as the claim — a verdict without its receipt in the same breath is " +
        "a horoscope. Never a bare state name.",
    },
    where_from: {
      type: "string",
      description:
        "One or two sentences naming where this video's views actually came from, welded to what that means " +
        "for getting more of them. The ways in are given to you already in plain words — use those words.",
    },
    what_changed: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "How the two weeks differ, in plain words with the numbers attached. Null when nothing moved enough " +
        "to be worth a sentence.",
    },
    control_test: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "The one comparison that separates the video from the distribution, stated with both numbers: did the " +
        "people who already follow them keep showing up while YouTube's own feed fell? Null when the data " +
        "given says that split can't be trusted for this video.",
    },
    steady_note: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Only when one of the two given misreadings actually applies here — the time-watched fall that comes " +
        "with being shown to people who don't know the channel, or a video still settling in its first weeks. " +
        "One or two calm sentences. Null when neither applies. Never invent reassurance.",
    },
    options: {
      type: "array",
      description:
        "2 or 3 typed responses the creator picks from — one 'safe', one 'reach', and a 'bold' only if the " +
        "data supports a third. Never three for the sake of three. Each must be something they can actually " +
        "do, and the cheapest testable version of itself.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "effort", "text", "category", "why", "confidence", "evidence"],
        properties: {
          type: { type: "string", enum: ["safe", "reach", "bold"] },
          category: {
            type: "string",
            enum: ["packaging", "content", "retention"],
            description: "Which kind of work this is — it files the pick in their Ledger so the Scorekeeper's record by kind stays true.",
          },
          effort: {
            type: "string",
            enum: ["minimal edit", "re-cut", "format change", "next upload", "new video"],
            description:
              "What it honestly costs them. A live video's title and description can be changed today — that " +
              "is a 'minimal edit'. Only use 'next upload' or 'new video' when the change genuinely can't be " +
              "made to this video.",
          },
          text: { type: "string", description: "The choice in one plain imperative sentence." },
          why: {
            type: "string",
            description:
              "What this video's own numbers show that points at this move — the revelation and the action in " +
              "one sentence, never generic advice.",
          },
          confidence: { type: "integer", description: "0-100, derived per the confidence rules from citable evidence only." },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "label"],
              properties: {
                kind: { type: "string", enum: ["ledger", "library", "search", "audience", "caution"] },
                label: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `You are the team of six at manfriday, answering ONE question together: how did viewers
find this video, and when the way in changed, was that the video or the way YouTube spread it? This is
the moment a creator panics, so the read is calm, specific, and never flattering.

How you decide:
- The people who already follow them (subscriptions feeds, notifications) are the way in that YouTube's
  recommendations don't touch. YouTube putting it in front of people (suggestions beside other videos,
  the Shorts feed, the home page) is entirely YouTube's choice.
- If YouTube's own feed fell while the people who already follow them held, the video did not get worse
  and the distribution moved. If both fell together, the video is the more likely cause. Say which, with
  both numbers in the same sentence as the claim.

Hard limits:
- Name only causes from the list you are given in the material. Never invent a reason, a number, an
  event, or a date.
- Never claim how often a thumbnail was shown or clicked — YouTube does not share that here.
- Where the schema asks for options, the count is 2 or 3. That overrides the "exactly three" in the
  shared option rules below: two honest options beat three with one invented.
- Prefer the cheapest testable version of every option. A live video's title and description can be
  changed today, and that beats "on your next upload" whenever the data supports it.
- Keep every field short enough to read on a phone.

${OPTIONS_RULES}`;

/** What YouTube itself publishes about why a video's reach moves — the whole
    list an analyst may name, and nothing beyond it. */
const REACH_REASONS = `WHAT YOUTUBE ITSELF SAYS MOVES A VIDEO'S REACH (the only causes you may name — pick the ones
this data supports, and say plainly when you can't tell which)
- The audience is watching something else right now. People binge a subject and then move on.
- The topic is saturated: a lot of people made this video recently.
- Supply and demand in this subject shifted.
- Seasonality: this subject has months where people look for it and months where they don't.`;

/** The two things creators reliably misread — stated only where they apply. */
const MISREADINGS = `TWO THINGS CREATORS MISREAD (state whichever genuinely applies here, in plain words; never invent
reassurance)
- When YouTube widens a video to people who don't know the channel, the average time watched FALLS.
  That fall is what widening looks like, not the video getting worse.
- A video's numbers commonly keep moving for one to two weeks after it goes up. A drop on day two is
  usually the numbers still settling.`;

type FoundRow = { label: string; views: number; share: number };
type ChangeRow = { key: BucketKey; label: string; recent: number; prior: number };

const BUCKET_ORDER: BucketKey[] = ["feed", "search", "followers", "links"];

function foundRows(sources: { type: string; views: number }[]): { rows: FoundRow[]; total: number } {
  const total = sources.reduce((n, s) => n + s.views, 0);
  const rows = sources
    .filter((s) => s.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 6)
    .map((s) => ({ label: plainSource(s.type), views: s.views, share: total ? s.views / total : 0 }));
  return { rows, total };
}

function changeRows(recent: Buckets, prior: Buckets): ChangeRow[] {
  return BUCKET_ORDER
    .filter((k) => recent[k] > 0 || prior[k] > 0)
    .map((k) => ({ key: k, label: BUCKET_LABEL[k], recent: recent[k], prior: prior[k] }));
}

function toMarkdown(a: Distribution, title: string): string {
  const lines = [`## How viewers found it`, a.verdict, a.where_from];
  if (a.what_changed) lines.push(`## What changed`, a.what_changed);
  if (a.control_test) lines.push(`## Your video, or the distribution?`, a.control_test);
  if (a.steady_note) lines.push(`## Before you panic`, a.steady_note);
  if (a.options.length) {
    lines.push(
      `## What you can do about it — pick what you'll actually do`,
      a.options.map((o) => `- ${o.text} (${o.effort}) — ${o.why}`).join("\n")
    );
  }
  lines.push(`*Video: "${title}"*`);
  return lines.join("\n\n");
}

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ytVideoId: string | undefined = body.video;
  if (!ytVideoId) return NextResponse.json({ error: "Missing video id" }, { status: 400 });

  const [{ data: tokenRow }, { data: video }, { data: chans }] = await Promise.all([
    svc.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
    svc.from("videos").select("id,channel_id,title,published_at,is_short").eq("user_id", user.id).eq("yt_video_id", ytVideoId).maybeSingle(),
    svc.from("channels").select("id,title,subscriber_count").eq("user_id", user.id).eq("is_owned", true).limit(1),
  ]);
  const channel = chans?.[0];
  if (!tokenRow || !channel) return NextResponse.json({ error: "Connect your channel first." }, { status: 400 });
  if (!video) return NextResponse.json({ error: "This video isn't in your analysis yet — run the first analysis on the Desk." }, { status: 400 });

  const seat = sentenceCase(TEAM_ATTRIBUTION.name);

  return analystStream(async (emit) => {
    const started = performance.now();
    const now = new Date();
    emit.stage(`${seat} is pulling up how viewers found this one…`);

    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);

    // Only needed if the read gets past the floor — start it now, read it there.
    const groundingPromise = analystGrounding(svc, user.id);
    void groundingPromise.catch(() => {});

    const [lifetime, windows, { data: blRows }, { data: snapRows }] = await Promise.all([
      fetchTrafficSources(access, ytVideoId),
      fetchTrafficWindows(access, ytVideoId, now),
      svc.from("channel_baselines").select("format,median_views,sample_size")
        .eq("channel_id", video.channel_id).order("computed_at", { ascending: false }).limit(10),
      svc.from("video_snapshots").select("view_count,views_per_day,captured_at")
        .eq("video_id", video.id).order("captured_at", { ascending: false }).limit(1),
    ]);

    const fmt = video.is_short ? "shorts" : "longform";
    const baseline = ((blRows ?? []) as { format: string; median_views: number; sample_size: number }[])
      .find((b) => b.format === fmt);
    const snap = (snapRows ?? [])[0] as { view_count: number | null; views_per_day: number | null; captured_at: string } | undefined;

    const { rows: found, total: foundTotal } = foundRows(lifetime.sources);
    const recent = bucketTraffic(windows.recent);
    const prior = bucketTraffic(windows.prior);
    const change = changeRows(recent, prior);
    const spans = windowsFor(now);
    const windowDates = {
      recentFrom: spans.recent.from, recentTo: spans.recent.to,
      priorFrom: spans.prior.from, priorTo: spans.prior.to,
    };
    const comparedViews = recent.total + prior.total;

    const floor = distributionFloor({ publishedAt: video.published_at as string | null, comparedViews, now });
    if (floor) {
      // Below the floor the honest answer is the whole answer, and it costs
      // nothing to give: where the views came from is still a fact, and the
      // change is withheld rather than guessed at.
      emit.stage(
        floor.kind === "too_new"
          ? "Too new to compare against itself — saying so instead of guessing…"
          : "Too few views across the two weeks to read a change — saying so instead of guessing…"
      );
      const reason = floor.kind === "too_new"
        ? `YouTube's numbers on a video keep moving for a week or two after it goes up. This one is ${floor.ageDays} ` +
          `${floor.ageDays === 1 ? "day" : "days"} old, so anything called a drop today would be the numbers still ` +
          `settling — not something you did. From day ${MIN_AGE_DAYS} there are two full weeks to compare, and the ` +
          `team can tell your video apart from how YouTube is spreading it.`
        : `Across the two weeks the team compares, this video got ${comparedViews} ` +
          `${comparedViews === 1 ? "view" : "views"} in total — too few to tell a real change from ordinary ` +
          `week-to-week wobble. Where your views came from is below and it is real; what changed is not ` +
          `something the team will guess at.`;

      return {
        state: "too_early",
        reasonKind: floor.kind,
        reason,
        found, foundTotal, change: null,
        windows: windowDates,
        windowDays: WINDOW_DAYS,
        checkBy: null,
        analysis: null,
        report: null,
        baseline: {},
        timing: { gatherMs: Math.round(performance.now() - started), modelMs: 0, firstWordMs: null, totalMs: Math.round(performance.now() - started) },
      };
    }

    const splitCaution = recent.splitKnown && prior.splitKnown
      ? ""
      : `\nCAUTION: for this video YouTube reported home-page views and subscriptions-feed views together, so ` +
        `"people who already follow you" still contains home-page views. Say that plainly and do NOT state the ` +
        `control test as if the split were clean.`;

    const grounding = await groundingPromise;
    const userMsg = `
${grounding.audienceBlock}

${grounding.trackBlock}

THE QUESTION: how did viewers find this video, and when the way in changed, was that the video or the
way YouTube spread it?

THE VIDEO
Title: ${video.title ?? "(untitled)"}
Format: ${video.is_short ? "Short" : "Full video"}
Published: ${video.published_at ?? "unknown"}
Views so far: ${snap?.view_count ?? "unknown"}${snap?.views_per_day ? ` (~${snap.views_per_day} a day)` : ""}
Channel: ${channel.title ?? "their channel"} — ${channel.subscriber_count ?? "?"} subscribers
What this channel normally gets for this format: ${baseline ? `${baseline.median_views} views, across its last ${baseline.sample_size}` : "not established yet"}

HOW VIEWERS FOUND IT — EVERY VIEW SINCE IT WENT UP (${foundTotal} in total)
${found.length ? found.map((f) => `- ${f.label}: ${f.views} views (${Math.round(f.share * 100)} in every 100)`).join("\n") : "(YouTube hasn't attributed any views yet)"}

THE TWO WEEKS BEING COMPARED
Last week ${windowDates.recentFrom} to ${windowDates.recentTo}, against the week before, ${windowDates.priorFrom} to ${windowDates.priorTo}.
${change.map((c) => `- ${c.label}: ${c.recent} views last week, ${c.prior} the week before`).join("\n")}
Totals: ${recent.total} views last week, ${prior.total} the week before.

THE CONTROL TEST — the comparison that separates the video from the distribution
"People who already follow you" is the way in YouTube's recommendations don't touch: subscriptions
feeds and notifications. "YouTube putting it in front of people" is entirely YouTube's choice:
suggestions beside other videos, the Shorts feed, the home page.
If the followers number held while YouTube's own feed fell, the video did not get worse — the
distribution moved. If both fell together, the video is the more likely cause.${splitCaution}

${REACH_REASONS}

${MISREADINGS}
`.trim();

    const gatherMs = Math.round(performance.now() - started);
    emit.stage(`Comparing ${recent.total} views last week with ${prior.total} the week before — reading it now…`);

    let firstWordMs: number | null = null;
    const modelStarted = performance.now();
    const analysis = await analystJsonStream<Distribution>({
      system: SYSTEM,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 6000,
      proseField: "verdict",
      signal: emit.signal,
      onProse: (delta) => {
        if (firstWordMs === null) firstWordMs = Math.round(performance.now() - started);
        emit.prose(delta);
      },
    });
    const modelMs = Math.round(performance.now() - modelStarted);

    const checkBy = checkByDate(now);
    // `kind` is what tells this report apart from the team's why-verdict: both
    // are signed by the team (the roster is six — DESIGN.md §12), so the shape
    // has to carry the difference.
    const stored = { kind: "distribution", ...analysis, found, foundTotal, change, windows: windowDates, checkBy };

    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: TEAM_ATTRIBUTION.name,
        title: `How viewers found "${String(video.title ?? ytVideoId).slice(0, 60)}" — and what changed`,
        body_md: toMarkdown(analysis, String(video.title ?? ytVideoId)),
        data: stored,
        channel_id: video.channel_id,
        video_id: video.id,
      })
      .select("id,title,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return {
      state: analysis.state,
      reasonKind: null,
      reason: null,
      found, foundTotal, change,
      windows: windowDates,
      windowDays: WINDOW_DAYS,
      checkBy,
      analysis,
      report,
      baseline: snap ? { view_count: snap.view_count, views_per_day: snap.views_per_day, captured_at: snap.captured_at } : {},
      timing: { gatherMs, modelMs, firstWordMs, totalMs: Math.round(performance.now() - started) },
    };
  }, req.signal);
}
