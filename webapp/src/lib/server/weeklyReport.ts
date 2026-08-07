import type { SupabaseClient } from "@supabase/supabase-js";
import { analystJson, analystJsonStream } from "./claude";
import { TEAM_ATTRIBUTION } from "@/lib/team";

/** The team's weekly report, written from stored data only — no YouTube
    calls. Shared by the on-demand route and the Monday cron, so the report
    shows up whether or not the creator remembers to ask. */

type Weekly = { title: string; body_md: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "body_md"],
  properties: {
    title: { type: "string", description: "Short report title, e.g. 'Week of Aug 3 — steady, one decision'." },
    body_md: {
      type: "string",
      description:
        "Markdown. OPEN with a line starting '**In short** — ' and 2-3 plain-English sentences the creator could act " +
        "on without reading any further; then EXACTLY three sections: '## Your numbers', '## What your team did', " +
        "'## Needs you (one decision)'. " +
        "Bullets with '- '. Every number must come from the given data; where week-over-week isn't possible yet, say tracking starts now. " +
        "'Needs you' holds ONE decision, framed with its choices (e.g. apply a named tip or skip it) — never a list of chores, never a bare order.",
    },
  },
} as const;

export type WeeklyReportRow = { id: string; title: string; body_md: string; created_at: string };

/** Returns the inserted report, or null when the user has no owned channel.

    Pass `onProse` to have the report's markdown handed over as it is written —
    that is the on-demand route, where someone is waiting and watching. The
    Monday cron passes nothing and takes the whole report in one piece, since
    there is nobody there to read it early. */
export async function writeWeeklyReport(
  svc: SupabaseClient,
  userId: string,
  onProse?: (delta: string) => void,
  signal?: AbortSignal
): Promise<WeeklyReportRow | null> {
  const { data: chans } = await svc
    .from("channels")
    .select("id,title,handle,subscriber_count")
    .eq("user_id", userId).eq("is_owned", true).limit(1);
  const channel = chans?.[0];
  if (!channel) return null;

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [{ data: videos }, { data: snaps }, { data: bls }, { data: recs }, { data: ideaRows }] = await Promise.all([
    svc.from("videos").select("id,yt_video_id,title,published_at,is_short")
      .eq("channel_id", channel.id).order("published_at", { ascending: false }).limit(30),
    svc.from("video_snapshots").select("video_id,view_count,views_per_day,captured_at")
      .eq("user_id", userId).gte("captured_at", since).order("captured_at", { ascending: false }).limit(500),
    svc.from("channel_baselines").select("format,median_views,sample_size,computed_at")
      .eq("channel_id", channel.id).order("computed_at", { ascending: false }).limit(10),
    svc.from("recommendations").select("agent,category,recommendation,status,verdict,verdict_kind,created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    svc.from("recommendations").select("recommendation,notes,created_at")
      .eq("user_id", userId).eq("target_type", "idea").eq("status", "open")
      .order("created_at", { ascending: false }).limit(5),
  ]);

  type Snap = { video_id: string; view_count: number | null; views_per_day: number | null; captured_at: string };
  const byVideo = new Map<string, Snap[]>();
  for (const s of (snaps ?? []) as Snap[]) {
    const arr = byVideo.get(s.video_id) ?? [];
    arr.push(s);
    byVideo.set(s.video_id, arr);
  }

  const weekAgo = Date.now() - 7 * 86_400_000;
  let totalNow = 0;
  let totalThen = 0;
  let hasHistory = false;
  const videoLines: string[] = [];
  for (const v of (videos ?? []) as { id: string; title: string | null; published_at: string | null; is_short: boolean | null }[]) {
    const arr = byVideo.get(v.id) ?? [];
    const latest = arr[0];
    const oldest = arr[arr.length - 1];
    if (!latest?.view_count) continue;
    totalNow += latest.view_count;
    const grew = oldest && oldest.captured_at !== latest.captured_at && Date.parse(oldest.captured_at) <= weekAgo + 3 * 86_400_000;
    if (grew && oldest.view_count !== null) {
      hasHistory = true;
      totalThen += oldest.view_count;
    }
    const isNew = v.published_at && Date.parse(v.published_at) >= weekAgo;
    videoLines.push(
      `- "${v.title ?? "(untitled)"}"${v.is_short ? " (Short)" : ""}: ${latest.view_count} views` +
        (grew && oldest.view_count !== null ? ` (was ${oldest.view_count} at the last check)` : "") +
        (isNew ? " — NEW THIS WEEK" : "")
    );
  }

  // Split by the kind of claim each verdict can make: viewers staying longer
  // is a result, a view count moving is an observation, and YouTube's own test
  // is the creator reporting what YouTube found. The report never blends them.
  const ledgerCounts = {
    open: 0, applied: 0, resolved: 0,
    stayed: 0, noChange: 0, leftSooner: 0,
    reportedWon: 0, reportedLost: 0,
    watchedUp: 0, watchedSteady: 0, watchedDown: 0,
    tooEarly: 0,
  };
  for (const r of (recs ?? []) as { status: string; verdict: string | null; verdict_kind: string | null }[]) {
    if (r.status === "open") ledgerCounts.open++;
    if (r.status === "applied") ledgerCounts.applied++;
    if (r.status !== "resolved") continue;
    ledgerCounts.resolved++;
    // Rows written before kinds existed were judged on view counts alone.
    const kind = r.verdict_kind ?? (r.verdict === "unclear" ? "too_early" : "what_happened");
    if (kind === "too_early") ledgerCounts.tooEarly++;
    else if (kind === "viewers_stayed") {
      if (r.verdict === "worked") ledgerCounts.stayed++;
      else if (r.verdict === "failed") ledgerCounts.leftSooner++;
      else ledgerCounts.noChange++;
    } else if (kind === "head_to_head") {
      if (r.verdict === "worked") ledgerCounts.reportedWon++;
      else ledgerCounts.reportedLost++;
    } else {
      if (r.verdict === "worked") ledgerCounts.watchedUp++;
      else if (r.verdict === "failed") ledgerCounts.watchedDown++;
      else ledgerCounts.watchedSteady++;
    }
  }
  const recentTips = ((recs ?? []) as { agent: string; recommendation: string; status: string; created_at: string }[])
    .slice(0, 8)
    .map((r) => `- [${r.status}] ${r.recommendation} (${r.agent})`)
    .join("\n");
  const ideaLines = ((ideaRows ?? []) as { recommendation: string; notes: string | null }[])
    .map((i) => `- ${i.recommendation}${i.notes ? ` — ${i.notes.slice(0, 120)}` : ""}`)
    .join("\n");
  const blLines = ((bls ?? []) as { format: string; median_views: number; sample_size: number }[])
    .filter((b, i, a) => a.findIndex((x) => x.format === b.format) === i)
    .map((b) => `- ${b.format === "shorts" ? "Shorts" : "Full videos"}: normal is ${b.median_views} views (last ${b.sample_size})`)
    .join("\n");

  const userMsg = `
CHANNEL
${channel.title ?? channel.handle ?? "Your channel"} — ${channel.subscriber_count ?? "?"} subscribers
Today: ${new Date().toDateString()}

THE CHANNEL'S NORMAL
${blLines || "- not established yet"}

VIDEOS AND THEIR VIEWS (latest counts${hasHistory ? ", with the previous check where we have one" : ""})
Total tracked views now: ${totalNow}${hasHistory ? ` (was ${totalThen} at the last check, across videos with history)` : ""}
${videoLines.join("\n") || "- no tracked videos yet"}
${hasHistory ? "" : "\nNOTE: this is the first tracked week — there is no earlier check to compare against. Say tracking starts now; do NOT invent week-over-week changes."}

THE LEDGER (advice given and how it landed)
Open tips: ${ledgerCounts.open} · applied: ${ledgerCounts.applied} · checked: ${ledgerCounts.resolved}
Measured on real viewers (their retention curve, before the change vs after): viewers stayed longer ${ledgerCounts.stayed} · no real change ${ledgerCounts.noChange} · viewers left sooner ${ledgerCounts.leftSooner}
YouTube's own Test & Compare, as the creator reported it: picked ours ${ledgerCounts.reportedWon} · picked another ${ledgerCounts.reportedLost}
Watched on views only: views moved up ${ledgerCounts.watchedUp} · held steady ${ledgerCounts.watchedSteady} · moved down ${ledgerCounts.watchedDown}
Too early to judge: ${ledgerCounts.tooEarly}
Most recent tips:
${recentTips || "- none yet"}

OPEN IDEAS FROM VIEWERS
${ideaLines || "- none mined yet"}
`.trim();

  const call = {
    system: `You write the team's weekly report to the creator. Three sections, exactly: "## Your numbers" (their real figures, honestly framed), "## What your team did" (grounded in the ledger and idea list given — never invent activity), "## Needs you (one decision)" (the single highest-leverage decision this week, laid out as a choice with its options — e.g. "apply this tip, or skip it and tell the team why" — one decision only, the creator makes the call). Two-minute read, warm but straight. You are a guide, not a boss.

HOW TO REPORT VERDICTS — the ledger block gives them in three groups and they are not interchangeable:
- Measured on real viewers: the only group you may describe as a tip working or not working. Say it in viewers, not percentages.
- YouTube's own Test & Compare: always name it as the creator's own report of what YouTube's test picked — never as something the team measured.
- Watched on views only: an observation and nothing more. NEVER write that a tip caused, drove, led to or produced a change in views; a channel's views swing on their own. Say what happened, and say plainly that the numbers can't show why.
If a group is zero, leave it out — a zero is not a result.`,
    user: userMsg,
    schema: SCHEMA as unknown as Record<string, unknown>,
  };
  const weekly = onProse
    ? await analystJsonStream<Weekly>({ ...call, proseField: "body_md", onProse, signal })
    : await analystJson<Weekly>(call);

  const { data: report, error: rErr } = await svc
    .from("reports")
    .insert({
      user_id: userId,
      agent: TEAM_ATTRIBUTION.name,
      title: weekly.title.slice(0, 120),
      body_md: weekly.body_md,
      channel_id: channel.id,
    })
    .select("id,title,body_md,created_at")
    .single();
  if (rErr) throw new Error(rErr.message);
  return report as WeeklyReportRow;
}
