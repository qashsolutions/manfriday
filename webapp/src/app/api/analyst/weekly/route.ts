import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { analystJson, claudeConfigured } from "@/lib/server/claude";

export const maxDuration = 120;

/** The team's weekly report: your numbers, what the team did, and the ONE
    thing that needs you. Written from stored data only — no YouTube calls. */

type Weekly = { title: string; body_md: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "body_md"],
  properties: {
    title: { type: "string", description: "Short report title, e.g. 'Week of Aug 3 — steady, one thing to do'." },
    body_md: {
      type: "string",
      description:
        "Markdown with EXACTLY three sections: '## Your numbers', '## What your team did', '## Needs you (one thing)'. " +
        "Bullets with '- '. Every number must come from the given data; where week-over-week isn't possible yet, say tracking starts now. " +
        "'Needs you' holds ONE decision or action — never a list.",
    },
  },
} as const;

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: chans } = await svc
    .from("channels")
    .select("id,title,handle,subscriber_count")
    .eq("user_id", user.id).eq("is_owned", true).limit(1);
  const channel = chans?.[0];
  if (!channel) return NextResponse.json({ error: "Connect your channel and run the first analysis first." }, { status: 400 });

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [{ data: videos }, { data: snaps }, { data: bls }, { data: recs }, { data: ideaRows }] = await Promise.all([
    svc.from("videos").select("id,yt_video_id,title,published_at,is_short")
      .eq("channel_id", channel.id).order("published_at", { ascending: false }).limit(30),
    svc.from("video_snapshots").select("video_id,view_count,views_per_day,captured_at")
      .eq("user_id", user.id).gte("captured_at", since).order("captured_at", { ascending: false }).limit(500),
    svc.from("channel_baselines").select("format,median_views,sample_size,computed_at")
      .eq("channel_id", channel.id).order("computed_at", { ascending: false }).limit(10),
    svc.from("recommendations").select("agent,category,recommendation,status,verdict,created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    svc.from("recommendations").select("recommendation,notes,created_at")
      .eq("user_id", user.id).eq("target_type", "idea").eq("status", "open")
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

  const ledgerCounts = { open: 0, applied: 0, resolved: 0, worked: 0, mixed: 0, failed: 0 };
  for (const r of (recs ?? []) as { status: string; verdict: string | null }[]) {
    if (r.status === "open") ledgerCounts.open++;
    if (r.status === "applied") ledgerCounts.applied++;
    if (r.status === "resolved") ledgerCounts.resolved++;
    if (r.verdict === "worked") ledgerCounts.worked++;
    if (r.verdict === "mixed") ledgerCounts.mixed++;
    if (r.verdict === "failed") ledgerCounts.failed++;
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

THE LEDGER (advice given and how it's going)
Open tips: ${ledgerCounts.open} · applied: ${ledgerCounts.applied} · checked: ${ledgerCounts.resolved} (worked ${ledgerCounts.worked} / mixed ${ledgerCounts.mixed} / didn't ${ledgerCounts.failed})
Most recent tips:
${recentTips || "- none yet"}

OPEN IDEAS FROM VIEWERS
${ideaLines || "- none mined yet"}
`.trim();

  try {
    const weekly = await analystJson<Weekly>({
      system: `You write the team's weekly report to the creator. Three sections, exactly: "## Your numbers" (their real figures, honestly framed), "## What your team did" (grounded in the ledger and idea list given — never invent activity), "## Needs you (one thing)" (the single highest-leverage decision or action, chosen from the data; one thing only). Two-minute read, warm but straight.`,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
    });

    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: "The Team",
        title: weekly.title.slice(0, 120),
        body_md: weekly.body_md,
        channel_id: channel.id,
      })
      .select("id,title,body_md,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The weekly report couldn't finish." },
      { status: 502 }
    );
  }
}
