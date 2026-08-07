import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { analystJsonStream, analystStream, claudeConfigured } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";
import { checkByDate } from "@/lib/server/trafficData";
import { MIN_VIEWS_FOR_CURVE, RECENT_VIDEOS, allExits, bestHeld, readHookGrounding, type HookCandidate } from "@/lib/server/hookData";
import { SCHEMA, SYSTEM, hookMaterial } from "@/lib/server/hookPrompt";
import { GHOSTWRITE_LINE, OPENING_WORD_LIMIT, overOpeningLimit, type HookAnalysis } from "@/lib/hook";
import { TEAM, sentenceCase } from "@/lib/team";

export const maxDuration = 120;

/** The Hook Doctor — the Editor on openings alone.

    A large share of the viewers a video loses are gone inside the first thirty
    seconds, and that is the cheapest thing in the whole product to change: no
    re-shoot, no new idea, just different words at the front. So the read is
    narrow on purpose. It writes 2-3 openings and nothing else, each one
    carrying the second it was written against.

    The floor works differently here than on the distribution read, and the
    difference is deliberate. There, below the floor the model is never called,
    because a diagnosis without numbers is a horoscope. Here the model is
    always called: too few viewers changes what the openings are grounded in
    and what they are called — never whether the creator gets help. What is
    forbidden is faking the grounding, and `grounded` is decided out here by
    arithmetic so nothing downstream can talk it into being true. */

type VideoRow = {
  id: string;
  yt_video_id: string;
  title: string | null;
  duration_seconds: number | null;
  is_short: boolean | null;
};

function toMarkdown(a: HookAnalysis, subject: string): string {
  const lines = [`## A stronger opening for ${subject}`, a.in_short];
  if (a.where_they_left) lines.push(`## Where your viewers left`, a.where_they_left);
  if (a.voice_note) lines.push(`## About the voice`, a.voice_note);
  for (const r of a.rewrites) {
    lines.push(`### ${r.choice} (${r.effort})`, r.opening, `*Why:* ${r.why}`);
  }
  return lines.join("\n\n");
}

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ytVideoId: string | undefined = typeof body.video === "string" && body.video.trim() ? body.video.trim() : undefined;
  const draftRaw: string = typeof body.draft === "string" ? body.draft.trim() : "";
  const spoken: string | null = typeof body.spoken === "string" && body.spoken.trim()
    ? body.spoken.trim().slice(0, 4000)
    : null;
  const spokenFrom: string | null = typeof body.spokenFrom === "string" && body.spokenFrom.trim()
    ? body.spokenFrom.trim().slice(0, 200)
    : null;

  if (!ytVideoId && !draftRaw) {
    return NextResponse.json(
      { error: "Paste the opening you've drafted, or pick one of your videos to re-hook — the team needs one of the two to work on." },
      { status: 400 }
    );
  }
  // More than an opening is not this surface's job, and saying so costs nothing:
  // the answer arrives before a single word is generated.
  if (!ytVideoId && overOpeningLimit(draftRaw)) {
    return NextResponse.json({ error: GHOSTWRITE_LINE, limit: OPENING_WORD_LIMIT }, { status: 400 });
  }

  const mode: "draft" | "video" = ytVideoId ? "video" : "draft";
  const draft = mode === "draft" ? draftRaw : null;

  const [{ data: tokenRow }, { data: chans }, { data: targetRow }] = await Promise.all([
    svc.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
    svc.from("channels").select("id,title,subscriber_count").eq("user_id", user.id).eq("is_owned", true).limit(1),
    // Any of their videos can be re-hooked, not only the recent handful the
    // grounding pass reads — so the one they picked is looked up on its own.
    ytVideoId
      ? svc.from("videos").select("id,yt_video_id,title,duration_seconds,is_short")
          .eq("user_id", user.id).eq("yt_video_id", ytVideoId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const channel = (chans ?? [])[0] as { id: string; title: string | null; subscriber_count: number | null } | undefined;
  if (!tokenRow || !channel) return NextResponse.json({ error: "Connect your channel first." }, { status: 400 });
  const target = (targetRow ?? null) as VideoRow | null;
  if (ytVideoId && !target) {
    return NextResponse.json(
      { error: "This video isn't in your analysis yet — run the first analysis on the Desk." },
      { status: 400 }
    );
  }

  const seat = sentenceCase(TEAM.editor.name);

  return analystStream(async (emit) => {
    const started = performance.now();
    emit.stage(`${seat} is pulling up where viewers left your last few videos…`);

    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);

    // Needed only once the material is built — start it now, read it there.
    const groundingPromise = analystGrounding(svc, user.id);
    void groundingPromise.catch(() => {});

    const { data: vidRows } = await svc
      .from("videos")
      .select("id,yt_video_id,title,duration_seconds,is_short")
      .eq("channel_id", channel.id)
      .order("published_at", { ascending: false })
      .limit(RECENT_VIDEOS);
    const videos = (vidRows ?? []) as VideoRow[];

    // The picked video's own views matter even when it's older than the ones
    // the grounding pass reads, so it rides along in the snapshot lookup.
    const snapshotIds = [...new Set([...videos.map((v) => v.id), ...(target ? [target.id] : [])])];
    const { data: snapRows } = await svc
      .from("video_snapshots")
      .select("video_id,view_count,captured_at")
      .in("video_id", snapshotIds)
      .order("captured_at", { ascending: false })
      .limit(200);
    const latestViews = new Map<string, number | null>();
    for (const s of (snapRows ?? []) as { video_id: string; view_count: number | null }[]) {
      if (!latestViews.has(s.video_id)) latestViews.set(s.video_id, s.view_count);
    }

    const candidates: HookCandidate[] = videos.map((v) => ({
      ytVideoId: v.yt_video_id,
      title: v.title ?? "(untitled)",
      durationSeconds: v.duration_seconds,
      views: latestViews.get(v.id) ?? null,
    }));

    const grounding = await readHookGrounding(access, candidates);
    const exits = allExits(grounding);
    const held = bestHeld(grounding);

    emit.stage(
      grounding.grounded
        ? `Reading the first minute of ${grounding.videos.length} of your videos — the exact seconds viewers left…`
        : `Not enough viewers yet to see where people left — writing on craft, and saying so…`
    );

    const analystContext = await groundingPromise;
    const userMsg = hookMaterial({
      audienceBlock: analystContext.audienceBlock,
      trackBlock: analystContext.trackBlock,
      grounding,
      mode,
      draft,
      spoken,
      spokenFrom,
      video: target
        ? {
            title: target.title ?? "(untitled)",
            views: latestViews.get(target.id) ?? null,
            durationSeconds: target.duration_seconds,
            isShort: Boolean(target.is_short),
          }
        : null,
      channel: { title: channel.title, subscriberCount: channel.subscriber_count },
    });

    const gatherMs = Math.round(performance.now() - started);
    emit.stage(`${seat} is writing your openings…`);

    let firstWordMs: number | null = null;
    const modelStarted = performance.now();
    const analysis = await analystJsonStream<HookAnalysis>({
      system: SYSTEM,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 6000,
      proseField: "in_short",
      signal: emit.signal,
      onProse: (delta) => {
        if (firstWordMs === null) firstWordMs = Math.round(performance.now() - started);
        emit.prose(delta);
      },
    });
    const modelMs = Math.round(performance.now() - modelStarted);

    const checkBy = checkByDate(new Date());
    const subject = target ? `"${(target.title ?? target.yt_video_id).slice(0, 60)}"` : "your draft";

    // `kind` tells this read apart from the Editor's whole-video retention read:
    // both are signed by the Editor, so the stored shape carries the difference.
    const stored = {
      kind: "hook",
      ...analysis,
      grounded: grounding.grounded,
      exits,
      held,
      videosRead: grounding.videos.length,
      checkBy,
    };

    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: TEAM.editor.name,
        title: `A stronger opening for ${subject}`,
        body_md: toMarkdown(analysis, subject),
        data: stored,
        channel_id: channel.id,
        ...(target ? { video_id: target.id } : {}),
      })
      .select("id,title,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return {
      grounded: grounding.grounded,
      exits,
      held,
      videosRead: grounding.videos.length,
      belowFloor: grounding.belowFloor,
      viewsFloor: MIN_VIEWS_FOR_CURVE,
      target: target ? { ytVideoId: target.yt_video_id, title: target.title ?? target.yt_video_id } : null,
      draft,
      checkBy,
      analysis,
      report,
      timing: { gatherMs, modelMs, firstWordMs, totalMs: Math.round(performance.now() - started) },
    };
  }, req.signal);
}
