import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { fetchVideoComments } from "@/lib/server/publicYt";
import { analystJsonStream, analystStream, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";
import { TEAM, sentenceCase } from "@/lib/team";

export const maxDuration = 120;

/** The Listener: reads the channel's real comments and turns what
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
    summary: {
      type: "string",
      description:
        "What the comments as a whole are asking for, opening with '**In short** — ' and then 2-3 plain-English " +
        "sentences the creator could act on without reading any further.",
    },
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

  const seat = sentenceCase(TEAM.listener.name);

  return analystStream(async (emit) => {
    const started = performance.now();
    emit.stage(`${seat} is finding your most recent videos…`);

    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);
    const groundingPromise = analystGrounding(svc, user.id);
    void groundingPromise.catch(() => {});

    // Comments are fetched per-video: YouTube's channel-wide comment listing
    // has grown unreliable (returns processingFailure), so we sweep the most
    // recent uploads instead — up to ~200 comments across ~15 videos.
    const { data: vids } = await svc
      .from("videos").select("yt_video_id,title")
      .eq("channel_id", channel.id)
      .order("published_at", { ascending: false })
      .limit(15);
    const rows = (vids ?? []) as { yt_video_id: string; title: string | null }[];
    emit.stage(`Opening the comments on your ${rows.length} most recent ${rows.length === 1 ? "video" : "videos"}…`);

    // One request per video, but all of them at once — this used to be fifteen
    // round-trips end to end. fetchVideoComments answers [] rather than
    // throwing, so a video with comments off just contributes nothing.
    const perVideo = await Promise.all(
      rows.map(async (v) =>
        (await fetchVideoComments(access, v.yt_video_id, 100))
          .map((c) => ({ text: c.text, likes: c.likes, videoTitle: v.title }) satisfies CommentRow)
      )
    );
    const comments: CommentRow[] = perVideo.flat().slice(0, 200);
    if (comments.length === 0) {
      throw new Error(`No comments to read yet — ${TEAM.listener.name} needs viewers talking first.`);
    }
    emit.stage(
      `Reading ${comments.length} ${comments.length === 1 ? "comment" : "comments"} ` +
        "for what viewers actually asked you to make…"
    );

    const commentBlock = comments
      .map((c, i) => `#${i + 1} (${c.likes} likes${c.videoTitle ? `, on "${c.videoTitle}"` : ""}): ${c.text.replace(/\s+/g, " ")}`)
      .join("\n");

    const grounding = await groundingPromise;
    const gatherMs = Math.round(performance.now() - started);

    let firstWordMs: number | null = null;
    const modelStarted = performance.now();
    const mined = await analystJsonStream<Mined>({
      system: `You are ${TEAM.listener.name}. Read the creator's real comments and pull out what viewers are literally asking to see next — requests, repeated questions, "please make a video on…". Only count real asks; praise and small talk are not ideas. Quotes must be copied verbatim from the given comments. If there are no genuine requests, return an empty ideas list and say so in the summary — never pad.\n\n${OPTIONS_RULES}`,
      user: `${grounding.audienceBlock}\n\n${grounding.trackBlock}\n\nTHE CHANNEL'S COMMENTS (${comments.length} most relevant, with like counts)\n${commentBlock}`,
      schema: SCHEMA as unknown as Record<string, unknown>,
      proseField: "summary",
      signal: emit.signal,
      onProse: (delta) => {
        if (firstWordMs === null) firstWordMs = Math.round(performance.now() - started);
        emit.prose(delta);
      },
    });
    const modelMs = Math.round(performance.now() - modelStarted);

    // Land new ideas in the ledger; skip ones already there.
    const { data: existing } = await svc
      .from("recommendations").select("recommendation").eq("user_id", user.id).eq("target_type", "idea");
    const seen = new Set((existing ?? []).map((r) => String(r.recommendation).toLowerCase().trim()));
    const fresh = mined.ideas.filter((i) => !seen.has(i.title.toLowerCase().trim())).slice(0, 7);
    if (fresh.length) {
      const { error: iErr } = await svc.from("recommendations").insert(
        fresh.map((i) => ({
          user_id: user.id,
          agent: TEAM.listener.name,
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

    return {
      summary: mined.summary,
      found: mined.ideas.length,
      added: fresh.length,
      timing: { gatherMs, modelMs, firstWordMs, totalMs: Math.round(performance.now() - started) },
    };
  }, req.signal);
}
