import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import {
  parseVideoId, fetchPublicVideos, fetchPublicChannels, fetchChannelNormal,
  searchPublicVideos, typedPhrases, daysAgo, fmtDuration, engagementPer1000,
} from "@/lib/server/publicYt";
import { analystJson, claudeConfigured } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";

export const maxDuration = 120;

/** The Researcher: point it at a topic (or one video) and it comes back with
    the read, in plain English — built ONLY from public data it actually
    fetched. Reports land alongside the weekly ones. */

type Research = { title: string; body_md: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "body_md"],
  properties: {
    title: { type: "string", description: "Short report title in plain words, e.g. 'The read on: garage workshop videos'." },
    body_md: {
      type: "string",
      description:
        "Markdown. For a TOPIC: '## The lay of the land', '## What's working (and for whom)', '## Angles you could take (2-3, as choices)', '## What people type'. " +
        "For a SINGLE VIDEO: '## What this video is', '## How it's doing', '## What's worth taking (as choices, not orders)'. " +
        "Every number copied from the given data; a video from a big channel is not 'working' just because its views are big — compare against that channel's own size or normal where given. " +
        "End with one honest line about what this public data can NOT tell (no earnings, no click-through, no watch time of other channels).",
    },
  },
} as const;

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? "").trim().slice(0, 200);
  if (!query) return NextResponse.json({ error: "Give the Researcher a topic or a video link." }, { status: 400 });

  const [{ data: tokenRow }, { data: chans }] = await Promise.all([
    svc.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
    svc.from("channels").select("id,title,subscriber_count").eq("user_id", user.id).eq("is_owned", true).limit(1),
  ]);
  const myChannel = chans?.[0];
  if (!tokenRow || !myChannel) return NextResponse.json({ error: "Connect your channel first." }, { status: 400 });

  try {
    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);
    const grounding = await analystGrounding(svc, user.id);
    const videoId = parseVideoId(query);

    let material: string;
    if (videoId) {
      // Single-video read.
      const [video] = await fetchPublicVideos(access, [videoId]);
      if (!video) return NextResponse.json({ error: "YouTube couldn't find that video — check the link." }, { status: 404 });
      const ch = (await fetchPublicChannels(access, [video.channelId])).get(video.channelId) ?? null;
      const normal = ch?.uploadsPlaylistId ? await fetchChannelNormal(access, ch.uploadsPlaylistId, video.id) : null;
      const ratio = normal?.medianViews && video.viewCount !== null
        ? Math.round((video.viewCount / normal.medianViews) * 100) / 100
        : null;
      material = `
MODE: single video read

THE VIDEO (public data)
Title: ${video.title}
Channel: ${video.channelTitle}${ch && ch.subscriberCount !== null ? ` — ${ch.subscriberCount} subscribers` : ""}
Published: ${video.publishedAt ?? "unknown"}${daysAgo(video.publishedAt) !== null ? ` (${daysAgo(video.publishedAt)} days ago)` : ""}
Length: ${fmtDuration(video.durationSeconds)}
Views: ${video.viewCount ?? "unknown"} · likes: ${video.likeCount ?? "hidden"} · comments: ${video.commentCount ?? "hidden"}
Engagement: ${engagementPer1000(video) ?? "—"} likes+comments per 1000 views
Ran vs their own channel's normal: ${ratio !== null && normal?.medianViews ? `${ratio}× (their median is ${normal.medianViews} views)` : "couldn't be established"}
Description: ${video.description.slice(0, 1200) || "(none)"}
`.trim();
    } else {
      // Topic sweep.
      const ids = await searchPublicVideos(access, query, 15);
      if (!ids.length) return NextResponse.json({ error: "YouTube returned nothing for that — try different words." }, { status: 404 });
      const videos = await fetchPublicVideos(access, ids);
      const channels = await fetchPublicChannels(access, videos.map((v) => v.channelId));
      const phrases = await typedPhrases(query);
      const lines = videos.map((v) => {
        const ch = channels.get(v.channelId);
        const subs = ch && ch.subscriberCount !== null ? ch.subscriberCount : null;
        const travel = subs && v.viewCount !== null && subs > 0
          ? ` · views-to-subscribers ${Math.round((v.viewCount / subs) * 100) / 100}×`
          : "";
        return `- "${v.title}" — ${v.channelTitle}${subs !== null ? ` (${subs} subs)` : " (subs hidden)"} · ${v.viewCount ?? "?"} views · ${daysAgo(v.publishedAt) ?? "?"} days old · ${fmtDuration(v.durationSeconds)}${travel}`;
      });
      material = `
MODE: topic research
TOPIC: ${query}

WHAT YOUTUBE RETURNS FOR THIS TOPIC (top results, public data; views-to-subscribers above 1× means a video traveled beyond its own channel's audience — the only honest public 'ran hot' signal)
${lines.join("\n")}

WHAT PEOPLE TYPE INTO YOUTUBE (live suggestion phrases — phrases only, no volumes exist)
${phrases.length ? phrases.map((p) => `- ${p}`).join("\n") : "(no suggestions came back)"}
`.trim();
    }

    const userMsg = `
${grounding.audienceBlock}

${grounding.trackBlock}

THE CREATOR ASKING
Channel: ${myChannel.title ?? "their channel"} — ${myChannel.subscriber_count ?? "?"} subscribers

${material}
`.trim();

    const research = await analystJson<Research>({
      system: `You are the Researcher. The creator pointed you at something; come back with the read in plain English — grounded ONLY in the material given, sized to THIS creator's situation, with angles framed as choices they could take, never orders. A five-minute read at most.`,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
    });

    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: "The Researcher",
        title: research.title.slice(0, 120),
        body_md: research.body_md,
        channel_id: myChannel.id,
      })
      .select("id,title,body_md,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The research couldn't finish." },
      { status: 502 }
    );
  }
}
