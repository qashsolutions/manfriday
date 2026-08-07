import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import {
  parseVideoId, fetchPublicVideos, fetchPublicChannels, fetchChannelNormal,
  fetchVideoComments, typedPhrases, daysAgo, fmtDuration, engagementPer1000,
  type ChannelNormal,
} from "@/lib/server/publicYt";
import { cachedJson } from "@/lib/server/cache";
import { TEAM, sentenceCase } from "@/lib/team";
import { analystJsonStream, analystStream, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";

export const maxDuration = 120;

/** The Scout's comparison desk — the product's core compare flow: the creator
    picks ONE OF THEIR OWN videos (or their channel's normal) and a similar
    outside video, and the team reads them side by side on four things:
    views, viewer comments/asks, title, and account owner. All public data,
    never earnings. The whole team contributes, bylined; the creator picks
    the takeaways. */

type Evidence = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };
type ScoutAnalysis = {
  read: string;
  factors: { factor: string; theirs: string; yours: string; note: string }[];
  title_read: { their_title: string[]; your_title: string[]; note: string };
  viewers_say: {
    summary: string;
    receipts: { quote: string; likes: number }[];
    asks: string[];
    your_side: string;
  };
  retention_note: string;
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
  required: ["read", "factors", "title_read", "viewers_say", "retention_note", "you_can_act_on", "out_of_your_hands", "options"],
  properties: {
    read: {
      type: "string",
      description:
        "The honest overall read of why the two videos' views differ, opening with '**In short** — ' and then 2-3 " +
        "plain-English sentences the creator could act on without reading any further — neutral, no envy, no hype. " +
        "Say plainly when the gap is mostly channel size or age.",
    },
    factors: {
      type: "array",
      description: "5-8 rows comparing observable factors: views (each vs its own channel's normal where given), how new each is, length, engagement, channel size/age/catalogue. Values COPIED from the given data — em dash where a side is unknown. Plain-word factor names.",
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
    title_read: {
      type: "object",
      additionalProperties: false,
      required: ["their_title", "your_title", "note"],
      description: `${sentenceCase(TEAM.marketer.name)}'s side-by-side title read.`,
      properties: {
        their_title: { type: "array", items: { type: "string" }, description: "1-3 observations about what their title does (structure, searched words, promise)." },
        your_title: { type: "array", items: { type: "string" }, description: "1-3 observations about the creator's title — empty when no own video was chosen." },
        note: { type: "string", description: "One sentence: the single most useful difference, grounded in the typed phrases where given." },
      },
    },
    viewers_say: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "receipts", "asks", "your_side"],
      description: `${sentenceCase(TEAM.listener.name)}'s read of the OUTSIDE video's public comments.`,
      properties: {
        summary: { type: "string", description: "One or two sentences on what their commenters respond to. If no comments were given, say so." },
        receipts: {
          type: "array",
          description: "Up to 3 of the most telling comments, quoted VERBATIM from the given comments with their real like counts.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["quote", "likes"],
            properties: { quote: { type: "string" }, likes: { type: "integer" } },
          },
        },
        asks: { type: "array", items: { type: "string" }, description: "0-3 things their viewers literally ask for — only from the given comments, never invented." },
        your_side: { type: "string", description: "One honest sentence on the creator's own video's comments (what they say, or that there are none yet)." },
      },
    },
    retention_note: {
      type: "string",
      description: `${sentenceCase(TEAM.editor.name)}'s honest one-liner: outside videos' retention curves are private, so say what CAN'T be known here and what public signals (length, engagement) can and can't hint at. Never invent watch-time claims.`,
    },
    you_can_act_on: {
      type: "array",
      description: "1-3 factors the creator can actually influence, in plain words.",
      items: { type: "string" },
    },
    out_of_your_hands: {
      type: "array",
      description: "0-3 factors the creator cannot change (channel size, age, recency) — said honestly so they don't blame themselves.",
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

function toMarkdown(a: ScoutAnalysis, theirTitle: string, mineTitle: string | null): string {
  const lines: string[] = [`## The read`, a.read];
  if (a.factors.length) {
    lines.push(
      `## Factor by factor`,
      a.factors.map((f) => `- **${f.factor}** — them: ${f.theirs} · you: ${f.yours}. ${f.note}`).join("\n")
    );
  }
  lines.push(`## The titles`, [...a.title_read.their_title.map((s) => `- theirs: ${s}`), ...a.title_read.your_title.map((s) => `- yours: ${s}`), a.title_read.note].join("\n"));
  lines.push(`## What their viewers say`, [a.viewers_say.summary, ...a.viewers_say.receipts.map((r) => `> "${r.quote}" (${r.likes} likes)`), a.viewers_say.your_side].join("\n\n"));
  lines.push(`## On watch time`, a.retention_note);
  if (a.you_can_act_on.length) lines.push(`## You can act on`, a.you_can_act_on.map((s) => `- ${s}`).join("\n"));
  if (a.out_of_your_hands.length) lines.push(`## Out of your hands`, a.out_of_your_hands.map((s) => `- ${s}`).join("\n"));
  lines.push(`*Compared: "${theirTitle}"${mineTitle ? ` vs your "${mineTitle}"` : " vs your channel's normal"}*`);
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
  const mineYtId: string | null = typeof body.mine === "string" && body.mine ? body.mine : null;
  if (!videoId) return NextResponse.json({ error: "Paste a YouTube video link (or its 11-character id)." }, { status: 400 });

  const [{ data: tokenRow }, { data: chans }] = await Promise.all([
    svc.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
    svc.from("channels").select("id,yt_channel_id,title,subscriber_count").eq("user_id", user.id).eq("is_owned", true).limit(1),
  ]);
  const myChannel = chans?.[0];
  if (!tokenRow || !myChannel) return NextResponse.json({ error: "Connect your channel first." }, { status: 400 });

  const seat = sentenceCase(TEAM.scout.name);

  return analystStream(async (emit) => {
    const started = performance.now();
    emit.stage(`${seat} is looking up the video you pasted…`);

    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);

    const [video] = await fetchPublicVideos(access, [videoId]);
    if (!video) throw new Error("YouTube couldn't find that video — check the link.");
    if (video.channelId === myChannel.yt_channel_id) {
      throw new Error("That's one of your own videos — pick it in the 'compare with' box instead, and paste an outside video here.");
    }
    emit.stage(`Checking how “${video.title.slice(0, 60)}” did against its own channel's normal…`);

    // Their side: channel, their-own-normal (shared cache, 24h), comments.
    const theirChannel = (await fetchPublicChannels(access, [video.channelId])).get(video.channelId) ?? null;
    const theirNormal: ChannelNormal | null = theirChannel?.uploadsPlaylistId
      ? await cachedJson(svc, `chnormal:v1:${theirChannel.uploadsPlaylistId}`, 24 * 3600,
          () => fetchChannelNormal(access, theirChannel.uploadsPlaylistId as string))
      : null;
    const theirRatio = theirNormal?.medianViews && video.viewCount !== null
      ? Math.round((video.viewCount / theirNormal.medianViews) * 100) / 100
      : null;
    const theirComments = await fetchVideoComments(access, videoId, 40);
    emit.stage(
      theirComments.length
        ? `Reading ${theirComments.length} of their viewers' comments…`
        : "Their comments are off or empty — reading the numbers and the title instead…"
    );

    // The creator's side: chosen video (or channel normal), plus its comments.
    const { data: blRows } = await svc
      .from("channel_baselines").select("format,median_views,sample_size,computed_at")
      .eq("channel_id", myChannel.id).order("computed_at", { ascending: false }).limit(10);
    const myBaselines = ((blRows ?? []) as { format: string; median_views: number; sample_size: number }[])
      .filter((b, i, a) => a.findIndex((x) => x.format === b.format) === i);
    const myNormalLine = myBaselines.length
      ? myBaselines.map((b) => `${b.format === "shorts" ? "Shorts" : "Full videos"}: ${b.median_views} views median (last ${b.sample_size})`).join(" · ")
      : "not established yet";

    let mine: { title: string | null; published_at: string | null; duration_seconds: number | null; is_short: boolean | null } | null = null;
    let mineSnap: { view_count: number | null; views_per_day: number | null } | null = null;
    let mineComments: { text: string; likes: number }[] = [];
    if (mineYtId) {
      const { data: mv } = await svc
        .from("videos").select("id,title,published_at,duration_seconds,is_short")
        .eq("user_id", user.id).eq("yt_video_id", mineYtId).maybeSingle();
      if (!mv) throw new Error("That video of yours isn't in the analysis yet — run the first analysis on the Desk.");
      mine = mv;
      const { data: snaps } = await svc
        .from("video_snapshots").select("view_count,views_per_day")
        .eq("video_id", mv.id).order("captured_at", { ascending: false }).limit(1);
      mineSnap = snaps?.[0] ?? null;
      mineComments = await fetchVideoComments(access, mineYtId, 30);
    }
    const myFmt = mine?.is_short ? "shorts" : "longform";
    const myBaseline = myBaselines.find((b) => b.format === myFmt);
    const myRatio = mine && myBaseline?.median_views && mineSnap?.view_count != null
      ? Math.round((mineSnap.view_count / myBaseline.median_views) * 100) / 100
      : null;

    const words = video.title.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
    const phrases = await typedPhrases(words.slice(0, 4).join(" "));
    const grounding = await analystGrounding(svc, user.id);

    const userMsg = `
${grounding.audienceBlock}

${grounding.trackBlock}

THE OUTSIDE VIDEO (all public data)
Title: ${video.title}
Channel: ${video.channelTitle}${theirChannel && theirChannel.subscriberCount !== null ? ` — ${theirChannel.subscriberCount} subscribers` : " — subscriber count hidden"}${theirChannel?.videoCount ? `, ${theirChannel.videoCount} videos` : ""}${theirChannel?.publishedAt ? `, channel since ${theirChannel.publishedAt.slice(0, 4)}` : ""}
Published: ${video.publishedAt ?? "unknown"}${daysAgo(video.publishedAt) !== null ? ` (${daysAgo(video.publishedAt)} days ago)` : ""}
Length: ${fmtDuration(video.durationSeconds)}
Views: ${video.viewCount ?? "unknown"} · likes: ${video.likeCount ?? "hidden"} · comments: ${video.commentCount ?? "hidden"}
Engagement: ${engagementPer1000(video) ?? "—"} likes+comments per 1000 views
Ran vs THEIR OWN channel's normal: ${theirRatio !== null && theirNormal?.medianViews ? `${theirRatio}× (their median is ${theirNormal.medianViews} views over last ${theirNormal.sampleSize})` : "their normal couldn't be established"}
Description (first lines): ${video.description.slice(0, 500) || "(none)"}

THEIR VIDEO'S TOP PUBLIC COMMENTS (verbatim, with like counts${theirComments.length ? "" : " — none were available"})
${theirComments.map((c) => `- (${c.likes} likes) ${c.text.replace(/\s+/g, " ")}`).join("\n") || "(no comments available)"}

THE CREATOR'S SIDE
Channel: ${myChannel.title ?? "their channel"} — ${myChannel.subscriber_count ?? "?"} subscribers
Their channel's normal: ${myNormalLine}
${mine ? `THE CREATOR'S CHOSEN VIDEO TO COMPARE
Title: ${mine.title ?? "(untitled)"}
Published: ${mine.published_at ?? "unknown"}${daysAgo(mine.published_at) !== null ? ` (${daysAgo(mine.published_at)} days ago)` : ""}
Length: ${fmtDuration(mine.duration_seconds)}${mine.is_short ? " (Short)" : ""}
Views: ${mineSnap?.view_count ?? "unknown"}${mineSnap?.views_per_day ? ` (~${mineSnap.views_per_day} a day)` : ""}
Ran vs their own normal: ${myRatio !== null ? `${myRatio}×` : "not established"}
Their video's comments${mineComments.length ? " (verbatim)" : ""}:
${mineComments.map((c) => `- (${c.likes} likes) ${c.text.replace(/\s+/g, " ")}`).join("\n") || "(none yet)"}` : "No own video chosen — compare against the channel's normal instead."}

WHAT PEOPLE TYPE INTO YOUTUBE (live suggestions seeded from the outside video's title words)
${phrases.length ? phrases.map((p) => `- ${p}`).join("\n") : "(no suggestions came back)"}

Remember: never speculate about anyone's earnings; explain the view gap with the observable factors above only. Where the gap is mostly channel size or recency, say so plainly — that is a useful, honest answer.
`.trim();

    const gatherMs = Math.round(performance.now() - started);
    emit.stage(`${seat} is reading both sides…`);

    let firstWordMs: number | null = null;
    const modelStarted = performance.now();
    const analysis = await analystJsonStream<ScoutAnalysis>({
      system: `You are the Scout, coordinating the team's side-by-side read: the creator's video (or channel normal) against an outside video on a similar topic. The team covers four things — views, viewer comments/asks, titles, and account owner. Copy every number and quote from the given data. You are guides: the creator makes the call.\n\n${OPTIONS_RULES}`,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
      proseField: "read",
      signal: req.signal,
      onProse: (delta) => {
        if (firstWordMs === null) firstWordMs = Math.round(performance.now() - started);
        emit.prose(delta);
      },
    });
    const modelMs = Math.round(performance.now() - modelStarted);

    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: TEAM.scout.name,
        title: `"${video.title.slice(0, 60)}" vs ${mine?.title ? `"${String(mine.title).slice(0, 40)}"` : "your normal"}`,
        body_md: toMarkdown(analysis, video.title, mine?.title ?? null),
        data: analysis,
        channel_id: myChannel.id,
      })
      .select("id,title,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return {
      report,
      analysis,
      timing: { gatherMs, modelMs, firstWordMs, totalMs: Math.round(performance.now() - started) },
      video: {
        id: video.id, title: video.title, channelTitle: video.channelTitle,
        viewCount: video.viewCount, likeCount: video.likeCount, commentCount: video.commentCount,
        publishedAt: video.publishedAt, durationSeconds: video.durationSeconds,
        subscriberCount: theirChannel?.subscriberCount ?? null,
        theirRatio,
      },
      mine: mine ? {
        title: mine.title, viewCount: mineSnap?.view_count ?? null,
        publishedAt: mine.published_at, durationSeconds: mine.duration_seconds, myRatio,
      } : null,
    };
  }, req.signal);
}
