import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow, yt } from "@/lib/server/youtube";
import { analystJson, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";

export const maxDuration = 120;

/** The Audience Analyst: reads the channel's real comments and turns what
    viewers literally ask for into a ranked idea list — every idea with a
    receipt (the actual comment). Ideas land in the Ledger as target_type=idea. */

type Evidence = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };
type Mined = {
  summary: string;
  ideas: {
    title: string;
    ask_count: number;
    receipt_quote: string;
    receipt_likes: number;
    note: string;
    confidence: number;
    evidence: Evidence[];
  }[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "ideas"],
  properties: {
    summary: { type: "string", description: "One or two sentences: what the comments as a whole are asking for." },
    ideas: {
      type: "array",
      description: "Up to 7 video ideas viewers are actually asking for, strongest demand first. Empty if the comments contain no real requests.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "ask_count", "receipt_quote", "receipt_likes", "note", "confidence", "evidence"],
        properties: {
          title: { type: "string", description: "A working video title, in the creator's voice." },
          ask_count: { type: "integer", description: "How many DISTINCT given comments support this idea. Count only from the comments provided." },
          receipt_quote: { type: "string", description: "The single best supporting comment, quoted VERBATIM from the given comments." },
          receipt_likes: { type: "integer", description: "That comment's like count, copied from the data. 0 if none." },
          note: { type: "string", description: "One line: why this idea, in plain words." },
          confidence: { type: "integer", description: "0-100, derived per the confidence rules — viewer demand counts as audience evidence." },
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

type CommentRow = { text: string; likes: number; videoTitle: string | null };

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [{ data: tokenRow }, { data: chans }] = await Promise.all([
    svc.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
    svc.from("channels").select("id,yt_channel_id").eq("user_id", user.id).eq("is_owned", true).limit(1),
  ]);
  const channel = chans?.[0];
  if (!tokenRow || !channel) return NextResponse.json({ error: "Connect your channel first." }, { status: 400 });

  try {
    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);

    // Up to ~200 top-level comments across the whole channel, most relevant first.
    const comments: CommentRow[] = [];
    const videoIds = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < 2; page++) {
      const data = await yt(
        `commentThreads?part=snippet&allThreadsRelatedToChannelId=${encodeURIComponent(channel.yt_channel_id as string)}` +
          `&maxResults=100&order=relevance&textFormat=plainText${pageToken ? `&pageToken=${pageToken}` : ""}`,
        access
      );
      for (const item of (data.items as Record<string, any>[] | undefined) ?? []) {
        const s = item.snippet?.topLevelComment?.snippet;
        if (!s?.textDisplay) continue;
        if (s.videoId) videoIds.add(s.videoId);
        comments.push({ text: String(s.textDisplay).slice(0, 400), likes: Number(s.likeCount ?? 0), videoTitle: s.videoId ?? null });
      }
      pageToken = data.nextPageToken as string | undefined;
      if (!pageToken) break;
    }
    if (comments.length === 0) {
      return NextResponse.json(
        { error: "No comments to read yet — the Audience Analyst needs viewers talking first." },
        { status: 409 }
      );
    }

    // Swap video ids for titles so quotes have context.
    if (videoIds.size) {
      const { data: vids } = await svc
        .from("videos").select("yt_video_id,title").eq("user_id", user.id).in("yt_video_id", [...videoIds]);
      const titleByYt = new Map((vids ?? []).map((v) => [v.yt_video_id as string, v.title as string | null]));
      for (const c of comments) c.videoTitle = c.videoTitle ? (titleByYt.get(c.videoTitle) ?? null) : null;
    }

    const commentBlock = comments
      .map((c, i) => `#${i + 1} (${c.likes} likes${c.videoTitle ? `, on "${c.videoTitle}"` : ""}): ${c.text.replace(/\s+/g, " ")}`)
      .join("\n");

    const grounding = await analystGrounding(svc, user.id);
    const mined = await analystJson<Mined>({
      system: `You are the Audience Analyst. Read the creator's real comments and pull out what viewers are literally asking to see next — requests, repeated questions, "please make a video on…". Only count real asks; praise and small talk are not ideas. Quotes must be copied verbatim from the given comments. If there are no genuine requests, return an empty ideas list and say so in the summary — never pad.\n\n${OPTIONS_RULES}`,
      user: `${grounding.audienceBlock}\n\n${grounding.trackBlock}\n\nTHE CHANNEL'S COMMENTS (${comments.length} most relevant, with like counts)\n${commentBlock}`,
      schema: SCHEMA as unknown as Record<string, unknown>,
    });

    // Land new ideas in the ledger; skip ones already there.
    const { data: existing } = await svc
      .from("recommendations").select("recommendation").eq("user_id", user.id).eq("target_type", "idea");
    const seen = new Set((existing ?? []).map((r) => String(r.recommendation).toLowerCase().trim()));
    const fresh = mined.ideas.filter((i) => !seen.has(i.title.toLowerCase().trim())).slice(0, 7);
    if (fresh.length) {
      const { error: iErr } = await svc.from("recommendations").insert(
        fresh.map((i) => ({
          user_id: user.id,
          agent: "Audience Analyst",
          category: "content",
          recommendation: i.title,
          target_type: "idea",
          notes: `${i.ask_count} viewer${i.ask_count === 1 ? "" : "s"} asked · "${i.receipt_quote}"${i.receipt_likes ? ` (${i.receipt_likes} likes)` : ""} — ${i.note}`,
          confidence: Math.max(0, Math.min(100, Math.round(i.confidence))),
          evidence: i.evidence ?? [],
        }))
      );
      if (iErr) throw new Error(iErr.message);
    }

    return NextResponse.json({ summary: mined.summary, found: mined.ideas.length, added: fresh.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The comment read couldn't finish." },
      { status: 502 }
    );
  }
}
