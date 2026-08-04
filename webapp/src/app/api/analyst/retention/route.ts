import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow, yt } from "@/lib/server/youtube";
import { fetchRetention, atLabel } from "@/lib/server/retentionData";
import { analystJson, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";

export const maxDuration = 120;

/** The Retention Analyst: reads the real retention curve (plus the video's own
    words and the channel's normal) and turns the marked drops into "here's why,
    here's the fix" — saved as a report, fixes logged to the Ledger. */

type Evidence = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };
type Analysis = {
  verdict: string;
  drop_reads: { at: number; label: string; likely_cause: string; fix: string }[];
  fixes: {
    recommendation: string;
    category: "retention" | "packaging" | "content";
    expected: string;
    confidence: number;
    evidence: Evidence[];
  }[];
  packaging_note: string | null;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "drop_reads", "fixes", "packaging_note"],
  properties: {
    verdict: {
      type: "string",
      description: "One or two sentences: the honest overall read of how this video held viewers and why.",
    },
    drop_reads: {
      type: "array",
      description: "One entry per marked drop, in video order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["at", "label", "likely_cause", "fix"],
        properties: {
          at: { type: "number", description: "The drop's position, 0-1, copied from the given data." },
          label: { type: "string", description: "The human timestamp label given for this drop." },
          likely_cause: { type: "string", description: "What most likely pushed viewers away at this moment, grounded in the transcript/description if given." },
          fix: { type: "string", description: "One concrete change for the next video." },
        },
      },
    },
    fixes: {
      type: "array",
      description: "1-3 fixes worth logging and tracking. Only fixes the creator can actually apply.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["recommendation", "category", "expected", "confidence", "evidence"],
        properties: {
          recommendation: { type: "string", description: "The tip, one sentence, imperative." },
          category: { type: "string", enum: ["retention", "packaging", "content"] },
          expected: { type: "string", description: "What should visibly change if this works, in plain words." },
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
    packaging_note: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Only if the title/thumbnail promise clearly mismatches where viewers leave; else null.",
    },
  },
} as const;

function toMarkdown(a: Analysis, videoTitle: string): string {
  const lines: string[] = [`## The read`, a.verdict];
  if (a.drop_reads.length) {
    lines.push(`## Where viewers left, and why`);
    for (const d of a.drop_reads) {
      lines.push(`### At ${d.label}`, d.likely_cause, `**Fix:** ${d.fix}`);
    }
  }
  if (a.packaging_note) lines.push(`## About the packaging`, a.packaging_note);
  if (a.fixes.length) {
    lines.push(
      `## Logged to your Ledger`,
      a.fixes.map((f) => `- ${f.recommendation} — *expect:* ${f.expected}`).join("\n")
    );
  }
  lines.push(`*Video: "${videoTitle}"*`);
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
  const transcript: string | undefined = typeof body.transcript === "string" ? body.transcript.slice(0, 30_000) : undefined;
  if (!ytVideoId) return NextResponse.json({ error: "Missing video id" }, { status: 400 });

  const [{ data: tokenRow }, { data: video }] = await Promise.all([
    svc.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
    svc.from("videos").select("id,channel_id,title,published_at,duration_seconds,is_short").eq("user_id", user.id).eq("yt_video_id", ytVideoId).maybeSingle(),
  ]);
  if (!tokenRow) return NextResponse.json({ error: "No channel is connected." }, { status: 400 });
  if (!video) return NextResponse.json({ error: "This video isn't in your analysis yet — run the first analysis on the Desk." }, { status: 400 });

  try {
    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);
    const ret = await fetchRetention(access, ytVideoId);
    if (!ret || ret.points.length < 2) {
      return NextResponse.json(
        { error: "YouTube hasn't produced a retention curve for this video yet — the analyst needs it to work." },
        { status: 409 }
      );
    }

    // The video's own words (live from YouTube) + the channel's normal.
    const [snippetData, { data: baselineRows }, { data: snapRows }] = await Promise.all([
      yt(`videos?part=snippet&id=${encodeURIComponent(ytVideoId)}`, access).catch(() => ({} as Record<string, unknown>)),
      svc.from("channel_baselines").select("format,median_views,sample_size")
        .eq("channel_id", video.channel_id).order("computed_at", { ascending: false }).limit(10),
      svc.from("video_snapshots").select("view_count,views_per_day,captured_at")
        .eq("video_id", video.id).order("captured_at", { ascending: false }).limit(1),
    ]);
    const snippet = (snippetData.items as Record<string, any>[] | undefined)?.[0]?.snippet ?? {};
    const fmt = video.is_short ? "shorts" : "longform";
    const baseline = ((baselineRows ?? []) as { format: string; median_views: number; sample_size: number }[])
      .find((b) => b.format === fmt);
    const snap = (snapRows ?? [])[0] as { view_count: number | null; views_per_day: number | null; captured_at: string } | undefined;
    const thin = !baseline || baseline.median_views < 100 || baseline.sample_size < 5;

    const dur = video.duration_seconds as number | null;
    const curveSample = ret.points
      .filter((_, i) => i % 5 === 0 || ret.points.length <= 40)
      .map((p) => `${Math.round(p.x * 100)}%: ${Math.round(p.watch * 100)}% still watching`)
      .join("; ");
    const dropsText = ret.drops
      .map((d, i) => `Drop ${i + 1} at ${atLabel(d.x, dur)} (position ${d.x.toFixed(2)}): lost ${Math.round(d.delta * 100)} of every 100 remaining viewers in one step`)
      .join("\n");

    const grounding = await analystGrounding(svc, user.id);
    const userMsg = `
${grounding.audienceBlock}

${grounding.trackBlock}

VIDEO
Title: ${video.title ?? "(untitled)"}
Format: ${video.is_short ? "Short" : "Full video"}${dur ? ` · length ${atLabel(1, dur)}` : ""}
Published: ${video.published_at ?? "unknown"}
Views so far: ${snap?.view_count ?? "unknown"}${snap?.views_per_day ? ` (~${snap.views_per_day} a day)` : ""}
Channel's normal for this format: ${baseline ? `${baseline.median_views} views (median of last ${baseline.sample_size})` : "not established yet"}
${thin ? "NOTE: this channel's numbers are still small — frame comparisons as context, not verdicts." : ""}

DESCRIPTION (the creator's own words)
${String(snippet.description ?? "").slice(0, 2000) || "(none)"}

RETENTION CURVE (share of viewers still watching, by position in the video)
${curveSample}

THE MARKED DROPS (the steepest losses — your job is to explain each one)
${dropsText || "(no sharp drops — the curve declines smoothly)"}

${transcript ? `TRANSCRIPT / SCRIPT (provided by the creator — quote it when explaining drops)\n${transcript}` : "No transcript was provided — reason from the title, description, drop positions, and how videos of this kind typically lose viewers. Say when you're inferring."}
`.trim();

    const analysis = await analystJson<Analysis>({
      system: `You are the Retention Analyst. Your one job: explain where and why this video lost viewers, and hand the creator fixes they can apply to the next upload. Use the drop timestamps given — never invent timestamps or quotes. Keep every field short enough to read on a phone.\n\n${OPTIONS_RULES}`,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
    });

    const bodyMd = toMarkdown(analysis, video.title ?? ytVideoId);
    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: "Retention Analyst",
        title: `Why "${(video.title ?? ytVideoId).slice(0, 80)}" held or lost viewers`,
        body_md: bodyMd,
        data: analysis,
        channel_id: video.channel_id,
        video_id: video.id,
      })
      .select("id,title,body_md,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    if (analysis.fixes.length) {
      await svc.from("recommendations").insert(
        analysis.fixes.slice(0, 3).map((f) => ({
          user_id: user.id,
          agent: "Retention Analyst",
          category: f.category,
          recommendation: f.recommendation,
          target_type: "video",
          target_yt_id: ytVideoId,
          baseline: snap ? { view_count: snap.view_count, views_per_day: snap.views_per_day, captured_at: snap.captured_at } : {},
          notes: f.expected,
          confidence: Math.max(0, Math.min(100, Math.round(f.confidence))),
          evidence: f.evidence ?? [],
        }))
      );
    }

    return NextResponse.json({ report, analysis });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The retention read couldn't finish." },
      { status: 502 }
    );
  }
}
