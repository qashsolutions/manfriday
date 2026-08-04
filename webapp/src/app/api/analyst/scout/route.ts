import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import {
  parseVideoId, fetchPublicVideos, fetchPublicChannels, fetchChannelNormal,
  typedPhrases, daysAgo, fmtDuration, engagementPer1000,
} from "@/lib/server/publicYt";
import { analystJson, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";

export const maxDuration = 120;

/** The Scout: compare any public video with the creator's own channel and
    explain the view gap with observable, neutral factors — recency, channel
    size, packaging, format, engagement, how it ran vs ITS OWN channel's
    normal. Views only, never revenue. The creator picks what to take from it. */

type Evidence = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };
type ScoutAnalysis = {
  read: string;
  factors: { factor: string; theirs: string; yours: string; note: string }[];
  you_can_act_on: string[];
  out_of_your_hands: string[];
  options: {
    type: "safe" | "reach" | "bold";
    takeaway: string;
    category: "packaging" | "content";
    why: string;
    confidence: number;
    evidence: Evidence[];
  }[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["read", "factors", "you_can_act_on", "out_of_your_hands", "options"],
  properties: {
    read: {
      type: "string",
      description: "Two or three sentences: the honest overall read of why this video's views differ from the creator's — neutral, no envy, no hype.",
    },
    factors: {
      type: "array",
      description: "5-8 rows comparing observable factors. Values must be COPIED from the given data — use an em dash where a side is unknown. Factor names in plain words (e.g. 'How new it is', 'Channel size', 'Ran vs their own normal').",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factor", "theirs", "yours", "note"],
        properties: {
          factor: { type: "string" },
          theirs: { type: "string", description: "Their side, copied from the data." },
          yours: { type: "string", description: "The creator's side, copied from the data." },
          note: { type: "string", description: "One short neutral sentence on what this factor does or doesn't explain." },
        },
      },
    },
    you_can_act_on: {
      type: "array",
      description: "1-3 factors from the table the creator can actually influence, in plain words.",
      items: { type: "string" },
    },
    out_of_your_hands: {
      type: "array",
      description: "0-3 factors the creator cannot change (channel size, age, recency of their old upload) — said honestly so they don't blame themselves.",
      items: { type: "string" },
    },
    options: {
      type: "array",
      description: "Exactly 3 takeaways the creator may log: safe / reach / bold, in that order. Each one concrete thing to try on THEIR next upload — never 'be like them'.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "takeaway", "category", "why", "confidence", "evidence"],
        properties: {
          type: { type: "string", enum: ["safe", "reach", "bold"] },
          takeaway: { type: "string", description: "One sentence, imperative, applicable to the creator's next upload." },
          category: { type: "string", enum: ["packaging", "content"] },
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
  },
} as const;

function toMarkdown(a: ScoutAnalysis, theirTitle: string): string {
  const lines: string[] = [`## The read`, a.read];
  if (a.factors.length) {
    lines.push(
      `## Factor by factor`,
      a.factors.map((f) => `- **${f.factor}** — them: ${f.theirs} · you: ${f.yours}. ${f.note}`).join("\n")
    );
  }
  if (a.you_can_act_on.length) lines.push(`## You can act on`, a.you_can_act_on.map((s) => `- ${s}`).join("\n"));
  if (a.out_of_your_hands.length) lines.push(`## Out of your hands`, a.out_of_your_hands.map((s) => `- ${s}`).join("\n"));
  lines.push(`*Compared video: "${theirTitle}"*`);
  return lines.join("\n\n");
}

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const videoId = parseVideoId(String(body.url ?? ""));
  if (!videoId) return NextResponse.json({ error: "Paste a YouTube video link (or its 11-character id)." }, { status: 400 });

  const [{ data: tokenRow }, { data: chans }] = await Promise.all([
    svc.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
    svc.from("channels").select("id,yt_channel_id,title,subscriber_count").eq("user_id", user.id).eq("is_owned", true).limit(1),
  ]);
  const myChannel = chans?.[0];
  if (!tokenRow || !myChannel) return NextResponse.json({ error: "Connect your channel first." }, { status: 400 });

  try {
    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);

    const [video] = await fetchPublicVideos(access, [videoId]);
    if (!video) return NextResponse.json({ error: "YouTube couldn't find that video — check the link." }, { status: 404 });

    const theirChannel = (await fetchPublicChannels(access, [video.channelId])).get(video.channelId) ?? null;
    const theirNormal = theirChannel?.uploadsPlaylistId
      ? await fetchChannelNormal(access, theirChannel.uploadsPlaylistId, video.id)
      : null;
    const theirRatio = theirNormal?.medianViews && video.viewCount !== null
      ? Math.round((video.viewCount / theirNormal.medianViews) * 100) / 100
      : null;

    // The creator's side, from what we already track.
    const { data: blRows } = await svc
      .from("channel_baselines").select("format,median_views,sample_size,computed_at")
      .eq("channel_id", myChannel.id).order("computed_at", { ascending: false }).limit(10);
    const myBaselines = ((blRows ?? []) as { format: string; median_views: number; sample_size: number }[])
      .filter((b, i, a) => a.findIndex((x) => x.format === b.format) === i);
    const myNormalLine = myBaselines.length
      ? myBaselines.map((b) => `${b.format === "shorts" ? "Shorts" : "Full videos"}: ${b.median_views} views median (last ${b.sample_size})`).join(" · ")
      : "not established yet";

    const words = video.title.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
    const phrases = await typedPhrases(words.slice(0, 4).join(" "));

    const grounding = await analystGrounding(svc, user.id);
    const isOwnVideo = video.channelId === myChannel.yt_channel_id;
    if (isOwnVideo) {
      return NextResponse.json({ error: "That's one of your own videos — the Scout compares outside videos. Try 'Why videos win or die' for your own." }, { status: 400 });
    }

    const userMsg = `
${grounding.audienceBlock}

${grounding.trackBlock}

THE VIDEO THE CREATOR WANTS TO LEARN FROM (all public data)
Title: ${video.title}
Channel: ${video.channelTitle}${theirChannel?.subscriberCount !== null && theirChannel ? ` — ${theirChannel.subscriberCount} subscribers` : " — subscriber count hidden"}${theirChannel?.videoCount ? `, ${theirChannel.videoCount} videos` : ""}${theirChannel?.publishedAt ? `, channel since ${theirChannel.publishedAt.slice(0, 4)}` : ""}
Published: ${video.publishedAt ?? "unknown"}${daysAgo(video.publishedAt) !== null ? ` (${daysAgo(video.publishedAt)} days ago)` : ""}
Length: ${fmtDuration(video.durationSeconds)}
Views: ${video.viewCount ?? "unknown"} · likes: ${video.likeCount ?? "hidden"} · comments: ${video.commentCount ?? "hidden"}
Engagement: ${engagementPer1000(video) ?? "—"} likes+comments per 1000 views
Ran vs THEIR OWN channel's normal: ${theirRatio !== null && theirNormal?.medianViews ? `${theirRatio}× (their median is ${theirNormal.medianViews} views over last ${theirNormal.sampleSize})` : "their normal couldn't be established"}
Description (first lines): ${video.description.slice(0, 500) || "(none)"}

THEIR CHANNEL'S RECENT UPLOADS (for context on what's normal for them)
${theirNormal?.recent.map((r) => `- "${r.title}" — ${r.viewCount ?? "?"} views`).join("\n") ?? "(unavailable)"}

THE CREATOR'S OWN SIDE
Channel: ${myChannel.title ?? "their channel"} — ${myChannel.subscriber_count ?? "?"} subscribers
Their normal: ${myNormalLine}

WHAT PEOPLE TYPE INTO YOUTUBE (live suggestions seeded from the compared video's title words)
${phrases.length ? phrases.map((p) => `- ${p}`).join("\n") : "(no suggestions came back)"}

Remember: never speculate about anyone's earnings; explain the view gap with the observable factors above only. Where the gap is mostly channel size or recency, say so plainly — that is a useful, honest answer.
`.trim();

    const analysis = await analystJson<ScoutAnalysis>({
      system: `You are the Scout. The creator brought a public video and wants to understand, neutrally, why it has the views it has compared with their own channel — and what, if anything, is worth taking from it. Copy every number from the given data. Factors you can't assess stay out of the table. You are a guide: the creator makes the call.\n\n${OPTIONS_RULES}`,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
    });

    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: "The Scout",
        title: `What "${video.title.slice(0, 70)}" can teach you`,
        body_md: toMarkdown(analysis, video.title),
        data: analysis,
        channel_id: myChannel.id,
      })
      .select("id,title,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return NextResponse.json({
      report,
      analysis,
      video: {
        id: video.id, title: video.title, channelTitle: video.channelTitle,
        viewCount: video.viewCount, publishedAt: video.publishedAt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The Scout couldn't finish the comparison." },
      { status: 502 }
    );
  }
}
