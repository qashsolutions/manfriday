import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow, yt } from "@/lib/server/youtube";
import { fetchRetention, atLabel } from "@/lib/server/retentionData";
import { fetchTrafficSources, TRAFFIC_LEGEND } from "@/lib/server/trafficData";
import { fetchVideoComments, typedPhrases, daysAgo } from "@/lib/server/publicYt";
import { analystJson, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";
import { SEATS, TEAM_ATTRIBUTION } from "@/lib/team";

export const maxDuration = 120;

/** The team's verdict on ONE question: why did this video get the views it
    got? Ranked likely reasons with evidence and the analyst behind each, a
    devil's-advocate counter-read, and one next step the creator may log.
    Works even before a retention curve exists. */

type Evidence = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };
type WhyAnalysis = {
  verdict: string;
  reasons: { reason: string; evidence: string; agent: string }[];
  devils_advocate: string;
  action: {
    text: string;
    category: "packaging" | "content" | "retention";
    why: string;
    confidence: number;
    evidence: Evidence[];
  };
};

const AGENTS = SEATS.map((s) => s.name);

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "reasons", "devils_advocate", "action"],
  properties: {
    verdict: {
      type: "string",
      description: "Two or three sentences: the honest answer to 'why did this video get the views it got'. On thin data, say plainly which parts can't be separated yet.",
    },
    reasons: {
      type: "array",
      description: "3-5 likely reasons, strongest first, each grounded ONLY in the given data — packaging, search demand, where traffic came from, channel size, video age, topic, what commenters responded to. Never invent a reason the data doesn't support.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reason", "evidence", "agent"],
        properties: {
          reason: { type: "string", description: "The reason in one plain sentence." },
          evidence: { type: "string", description: "The supporting fact, copied/derived from the given data, in one short sentence." },
          agent: { type: "string", enum: AGENTS as unknown as string[], description: "Which analyst this read belongs to." },
        },
      },
    },
    devils_advocate: {
      type: "string",
      description: "The deliberately counter-intuitive read: the boring or opposite explanation that could also be true, and what would prove it either way. 2-3 sentences, honest.",
    },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["text", "category", "why", "confidence", "evidence"],
      description: "The ONE next step most likely to get the next upload more views, applicable this week.",
      properties: {
        text: { type: "string", description: "One sentence, imperative." },
        category: { type: "string", enum: ["packaging", "content", "retention"] },
        why: { type: "string" },
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
} as const;

function toMarkdown(a: WhyAnalysis, title: string): string {
  return [
    `## The verdict`, a.verdict,
    `## The likely reasons`,
    a.reasons.map((r, i) => `${i + 1}. **${r.reason}** — ${r.evidence} *(${r.agent})*`).join("\n"),
    `## Playing devil's advocate`, a.devils_advocate,
    `## The one thing to do next`, `${a.action.text} — ${a.action.why}`,
    `*Video: "${title}"*`,
  ].join("\n\n");
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
    svc.from("videos").select("id,channel_id,title,published_at,duration_seconds,is_short").eq("user_id", user.id).eq("yt_video_id", ytVideoId).maybeSingle(),
    svc.from("channels").select("id,title,subscriber_count").eq("user_id", user.id).eq("is_owned", true).limit(1),
  ]);
  const channel = chans?.[0];
  if (!tokenRow || !channel) return NextResponse.json({ error: "Connect your channel first." }, { status: 400 });
  if (!video) return NextResponse.json({ error: "This video isn't in your analysis yet — run the first analysis on the Desk." }, { status: 400 });

  try {
    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);

    const titleWords = String(video.title ?? "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
    const [snippetData, traffic, comments, ret, { data: blRows }, { data: snapRows }, phrases, grounding] = await Promise.all([
      yt(`videos?part=snippet&id=${encodeURIComponent(ytVideoId)}`, access).catch(() => ({} as Record<string, unknown>)),
      fetchTrafficSources(access, ytVideoId),
      fetchVideoComments(access, ytVideoId, 15),
      fetchRetention(access, ytVideoId).catch(() => null),
      svc.from("channel_baselines").select("format,median_views,sample_size,videos")
        .eq("channel_id", video.channel_id).order("computed_at", { ascending: false }).limit(10),
      svc.from("video_snapshots").select("view_count,views_per_day,captured_at")
        .eq("video_id", video.id).order("captured_at", { ascending: false }).limit(1),
      titleWords.length ? typedPhrases(titleWords.slice(0, 4).join(" ")) : Promise.resolve([]),
      analystGrounding(svc, user.id),
    ]);
    const snippet = (snippetData.items as Record<string, any>[] | undefined)?.[0]?.snippet ?? {};
    const fmt = video.is_short ? "shorts" : "longform";
    const baseline = ((blRows ?? []) as { format: string; median_views: number; sample_size: number; videos: { title: string | null; view_count: number | null; flag: string }[] }[])
      .find((b) => b.format === fmt);
    const snap = (snapRows ?? [])[0] as { view_count: number | null; views_per_day: number | null } | undefined;
    const winners = (baseline?.videos ?? []).filter((v) => v.flag === "outperformer").slice(0, 4);
    const dur = video.duration_seconds as number | null;
    const dropsText = ret?.drops?.length
      ? ret.drops.map((d, i) => `Drop ${i + 1} at ${atLabel(d.x, dur)}: lost ${Math.round(d.delta * 100)} of every 100 remaining viewers`).join("; ")
      : "no retention curve available yet";

    const userMsg = `
${grounding.audienceBlock}

${grounding.trackBlock}

THE QUESTION: why did this video get the views it got?

THE VIDEO
Title: ${video.title ?? "(untitled)"}
Format: ${video.is_short ? "Short" : "Full video"}${dur ? ` · length ${atLabel(1, dur)}` : ""}
Published: ${video.published_at ?? "unknown"}${daysAgo(video.published_at) !== null ? ` (${daysAgo(video.published_at)} days ago)` : ""}
Views: ${snap?.view_count ?? "unknown"}${snap?.views_per_day ? ` (~${snap.views_per_day} a day)` : ""}
Channel: ${channel.title ?? "their channel"} — ${channel.subscriber_count ?? "?"} subscribers
Their usual for this format: ${baseline ? `${baseline.median_views} views (median of last ${baseline.sample_size})` : "not established yet"}
Description (their own words): ${String(snippet.description ?? "").slice(0, 1200) || "(none)"}

WHERE THE VIEWS ACTUALLY CAME FROM (YouTube Analytics, this video)
${traffic.sources.length ? traffic.sources.map((s) => `- ${s.type}: ${s.views} views`).join("\n") : "(no traffic data yet — too few views)"}
${traffic.searchTerms.length ? `Search terms that found it:\n${traffic.searchTerms.map((t) => `- "${t.term}": ${t.views}`).join("\n")}` : ""}
${TRAFFIC_LEGEND}

RETENTION (where viewers left)
${dropsText}

THIS VIDEO'S PUBLIC COMMENTS (verbatim${comments.length ? "" : " — none"})
${comments.map((c) => `- (${c.likes} likes) ${c.text.replace(/\s+/g, " ")}`).join("\n") || "(none)"}

THEIR OWN WINNERS FOR CONTEXT (videos that beat their usual)
${winners.length ? winners.map((w) => `- "${w.title ?? "untitled"}" — ${w.view_count ?? "?"} views`).join("\n") : "(none flagged yet)"}

WHAT PEOPLE TYPE INTO YOUTUBE (live suggestions from this title's words)
${phrases.length ? phrases.map((p) => `- ${p}`).join("\n") : "(no suggestions came back)"}
`.trim();

    const analysis = await analystJson<WhyAnalysis>({
      system: `You are the team of six at manfriday (${AGENTS.join(", ")}), answering ONE question together: why did this video get the views it got? Rank only reasons the given data supports, attribute each to the right analyst, then argue against yourselves honestly in devils_advocate — the boring explanation (channel size, video age, nobody searched this) often wins, and saying so IS the service. Then give the single next step. Keep every field short enough to read on a phone.\n\n${OPTIONS_RULES}`,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 6000,
    });

    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: TEAM_ATTRIBUTION.name,
        title: `Why "${String(video.title ?? ytVideoId).slice(0, 70)}" did what it did`,
        body_md: toMarkdown(analysis, String(video.title ?? ytVideoId)),
        data: analysis,
        channel_id: video.channel_id,
        video_id: video.id,
      })
      .select("id,title,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return NextResponse.json({
      report,
      analysis,
      baseline: snap ? { view_count: snap.view_count, views_per_day: snap.views_per_day } : {},
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The team's read couldn't finish." },
      { status: 502 }
    );
  }
}
