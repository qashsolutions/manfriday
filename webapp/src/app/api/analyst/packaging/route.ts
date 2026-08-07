import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { analystJsonStream, analystStream, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";
import { typedPhrases } from "@/lib/server/publicYt";
import { spread } from "@/lib/server/scorekeeper";
import { TEAM, sentenceCase } from "@/lib/team";

export const maxDuration = 120;

/** The Marketer: grades a draft title against the creator's OWN
    winners and losers (from their baselines) plus what people really type
    into YouTube (autocomplete phrases — phrases only, never volumes). */

type Evidence = { kind: "ledger" | "library" | "search" | "audience" | "caution"; label: string };
type GradeOption = {
  type: "safe" | "reach" | "bold";
  title: string;
  why: string;
  confidence: number;
  evidence: Evidence[];
  audience_fit: string | null;
};
type Grade = {
  grade: "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "D";
  one_line: string;
  strengths: string[];
  risks: string[];
  options: GradeOption[];
  search_note: string | null;
  thin_data_note: string | null;
  thumb_read: { one_line: string; works: string[]; risks: string[] } | null;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grade", "one_line", "strengths", "risks", "options", "search_note", "thin_data_note", "thumb_read"],
  properties: {
    grade: { type: "string", enum: ["A", "A-", "B+", "B", "B-", "C+", "C", "D"] },
    one_line: {
      type: "string",
      description:
        "The grade's reason, opening with '**In short** — ' and then 2-3 plain-English sentences the creator " +
        "could act on without reading any further — never a bare score.",
    },
    strengths: { type: "array", items: { type: "string" }, description: "0-3 things this draft does right." },
    risks: { type: "array", items: { type: "string" }, description: "0-3 ways this draft loses viewers before the click." },
    options: {
      type: "array",
      description: "Exactly 3 rewrites: one safe (their proven winners), one reach (typed phrases + their audience), one bold (untested but promising) — in that order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "why", "confidence", "evidence", "audience_fit"],
        properties: {
          type: { type: "string", enum: ["safe", "reach", "bold"] },
          title: { type: "string" },
          why: { type: "string", description: "One sentence, plain English." },
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
          audience_fit: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "One short clause on why this fits THEIR stated audience; null when no profile exists.",
          },
        },
      },
    },
    search_note: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "If the typed-phrases list clearly supports a wording, say which — phrased as 'people type…', never volumes. Else null.",
    },
    thin_data_note: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "If the channel's own sample is too small to grade against, one honest sentence. Else null.",
    },
    thumb_read: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["one_line", "works", "risks"],
          properties: {
            one_line: { type: "string", description: "The honest one-line read of the draft thumbnail." },
            works: { type: "array", items: { type: "string" }, description: "0-3 things the draft thumbnail does right — legibility at small size, one clear subject, contrast, promise matching the title." },
            risks: { type: "array", items: { type: "string" }, description: "0-3 concrete ways it loses the click — tiny text, clutter, no focal point, mismatch with the title's promise." },
          },
        },
        { type: "null" },
      ],
      description: "Only when a draft thumbnail image was provided; else null. Judge it as it will appear: tiny, next to dozens of others.",
    },
  },
} as const;

type BaselineDetail = {
  title: string | null;
  view_count: number | null;
  ratio_to_median: number | null;
  flag: string;
};

/** The readable render of a grade, stored beside the structured shape so the
    Ledger, the exports and a reload all read the same words. */
function toMarkdown(draft: string, g: Grade): string {
  const lines = [`**Your draft:** "${draft}"`, "", `**Grade ${g.grade}** — ${g.one_line}`];
  if (g.strengths.length) lines.push("", "### What's working", ...g.strengths.map((s) => `- ${s}`));
  if (g.risks.length) lines.push("", "### Where it loses people", ...g.risks.map((s) => `- ${s}`));
  if (g.thumb_read) {
    lines.push("", "### The thumbnail", g.thumb_read.one_line);
    lines.push(...g.thumb_read.works.map((s) => `- ${s}`), ...g.thumb_read.risks.map((s) => `- ${s}`));
  }
  lines.push("", "### Three ways to go — you pick");
  const label = { safe: "The safe bet", reach: "The smart reach", bold: "The bold swing" } as const;
  for (const o of g.options) lines.push(`- **${label[o.type] ?? "Option"}:** "${o.title}" — ${o.why}`);
  if (g.search_note) lines.push("", `**People type:** ${g.search_note}`);
  if (g.thin_data_note) lines.push("", `**Early days:** ${g.thin_data_note}`);
  return lines.join("\n");
}

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const draft: string = String(body.title ?? "").trim().slice(0, 200);
  if (!draft) return NextResponse.json({ error: "Type a draft title first." }, { status: 400 });

  // Optional draft thumbnail: a data URL from the browser, ≤ ~4MB encoded.
  let thumb: { mediaType: string; data: string } | null = null;
  if (typeof body.thumbnail === "string" && body.thumbnail.startsWith("data:image/")) {
    const m = body.thumbnail.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    if (!m) return NextResponse.json({ error: "That image format didn't come through — use a PNG, JPG or WebP." }, { status: 400 });
    if (m[2].length > 4_500_000) return NextResponse.json({ error: "That image is too large — keep the draft under ~3MB." }, { status: 400 });
    thumb = { mediaType: m[1], data: m[2] };
  }

  const { data: chans } = await svc
    .from("channels").select("id,title,handle").eq("user_id", user.id).eq("is_owned", true).limit(1);
  const channel = chans?.[0];
  if (!channel) return NextResponse.json({ error: "Connect your channel and run the first analysis first." }, { status: 400 });

  const { data: blRows } = await svc
    .from("channel_baselines")
    .select("format,median_views,sample_size,videos,computed_at")
    .eq("channel_id", channel.id)
    .order("computed_at", { ascending: false })
    .limit(10);

  const latestByFormat = new Map<string, { median_views: number; sample_size: number; videos: BaselineDetail[] }>();
  for (const b of (blRows ?? []) as { format: string; median_views: number; sample_size: number; videos: BaselineDetail[] }[]) {
    if (!latestByFormat.has(b.format)) latestByFormat.set(b.format, b);
  }
  if (latestByFormat.size === 0) {
    return NextResponse.json({ error: "Run the first analysis on the Desk first — grading needs your baseline." }, { status: 400 });
  }

  const thin = [...latestByFormat.values()].every((b) => b.median_views < 100 || b.sample_size < 5);

  const titleLines = (label: string, vids: BaselineDetail[]) =>
    vids.length
      ? `${label}\n` + vids.map((v) => `- "${v.title ?? "(untitled)"}" — ${v.view_count ?? "?"} views, ${v.ratio_to_median ?? "?"}× the channel's normal`).join("\n")
      : "";

  const sections: string[] = [];
  for (const [fmt, b] of latestByFormat) {
    const vids = (b.videos ?? []) as BaselineDetail[];
    const winners = vids.filter((v) => v.flag === "outperformer").slice(0, 6);
    const losers = vids.filter((v) => v.flag === "underperformer").slice(0, 4);
    const typical = vids.filter((v) => v.flag === "typical").slice(0, 6);
    sections.push(
      `${fmt === "shorts" ? "SHORTS" : "FULL VIDEOS"} — normal is ${b.median_views} views (last ${b.sample_size})\n` +
        [titleLines("Their winners:", winners), titleLines("Their misses:", losers), titleLines("Typical:", typical)]
          .filter(Boolean)
          .join("\n")
    );
  }

  const seat = sentenceCase(TEAM.marketer.name);

  return analystStream(async (emit) => {
    const started = performance.now();
    emit.stage(`${seat} is lining your draft up against your own winners…`);

    // What people actually type — two seeds from the draft's own words. Neither
    // this nor the grounding depends on the other, so run them together.
    const words = draft.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
    const seeds = [words.slice(0, 3).join(" "), words.slice(0, 5).join(" ")].filter((s, i, a) => s && a.indexOf(s) === i);
    const [phraseLists, grounding] = await Promise.all([
      Promise.all(seeds.map(typedPhrases)),
      analystGrounding(svc, user.id),
    ]);
    const phrases = [...new Set(phraseLists.flat())].slice(0, 12);
    emit.stage(
      phrases.length
        ? `Reading the ${phrases.length} ${phrases.length === 1 ? "phrase" : "phrases"} people really type around this topic…`
        : "YouTube offered no typed phrases for this one — grading on title craft alone…"
    );

    const userMsg = `
${grounding.audienceBlock}

${grounding.trackBlock}

THE DRAFT TITLE TO GRADE
"${draft}"

THE CREATOR'S OWN TRACK RECORD (titles with how they performed vs their normal)
${sections.join("\n\n")}
${thin ? "\nNOTE: this channel's numbers are still small — grade mostly on title craft and the typed phrases, and say so in thin_data_note." : ""}

WHAT PEOPLE REALLY TYPE INTO YOUTUBE (live suggestions seeded from the draft's own words)
${phrases.length ? phrases.map((p) => `- ${p}`).join("\n") : "(no suggestions came back — grade without them and leave search_note null)"}
`.trim();

    // With a draft thumbnail: attach it, plus up to 3 of their own recent
    // thumbnails for style context (public i.ytimg.com URLs).
    type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } };
    let userContent: string | Block[] = userMsg;
    if (thumb) {
      const blocks: Block[] = [
        { type: "text", text: userMsg },
        { type: "text", text: "THE DRAFT THUMBNAIL for this title (judge it tiny, next to dozens of others):" },
        { type: "image", source: { type: "base64", media_type: thumb.mediaType, data: thumb.data } },
      ];
      const { data: recentThumbs } = await svc
        .from("videos").select("title,thumbnail_url")
        .eq("channel_id", channel.id).not("thumbnail_url", "is", null)
        .order("published_at", { ascending: false }).limit(3);
      for (const t of (recentThumbs ?? []) as { title: string | null; thumbnail_url: string }[]) {
        blocks.push({ type: "text", text: `One of the creator's own recent thumbnails ("${t.title ?? "untitled"}") — style context:` });
        blocks.push({ type: "image", source: { type: "url", url: t.thumbnail_url } });
      }
      userContent = blocks;
      emit.stage(`${seat} is looking at your thumbnail next to your recent ones…`);
    }

    const gatherMs = Math.round(performance.now() - started);
    emit.stage(`${seat} is grading it…`);

    let firstWordMs: number | null = null;
    const modelStarted = performance.now();
    const analysis = await analystJsonStream<Grade>({
      system: `You are ${TEAM.marketer.name}. Grade the draft title honestly against this creator's own winners and misses — patterns in THEIR titles, not generic YouTube advice. Rewrites must sound like this creator, promise something concrete, and avoid clickbait they'd regret. Grade craft, not luck.${thumb ? " A draft thumbnail image is attached: fill thumb_read with an honest read of it (title and thumbnail are one promise — judge them together)." : " No thumbnail was provided: thumb_read must be null."}\n\n${OPTIONS_RULES}`,
      user: userContent as never,
      schema: SCHEMA as unknown as Record<string, unknown>,
      proseField: "one_line",
      signal: emit.signal,
      onProse: (delta) => {
        if (firstWordMs === null) firstWordMs = Math.round(performance.now() - started);
        emit.prose(delta);
      },
    });

    // The grade goes on the record. Until now it lived only in this response:
    // a reload lost it, and a title the creator picked had no read behind it
    // for the Scorekeeper to point at later. Stored with the normal it was
    // graded against, so the comparison can be repeated exactly.
    const normal = [...latestByFormat.entries()].map(([format, b]) => {
      const sw = spread((b.videos ?? []).map((v) => v.view_count));
      return {
        format,
        usual_views: b.median_views,
        sample_size: b.sample_size,
        swing: sw ? { low: sw.low, high: sw.high } : null,
      };
    });
    const { data: report, error: rErr } = await svc
      .from("reports")
      .insert({
        user_id: user.id,
        agent: TEAM.marketer.name,
        title: `Title grade for "${draft.slice(0, 60)}"`,
        body_md: toMarkdown(draft, analysis),
        data: { kind: "packaging", draft, ...analysis, phrases, normal },
        channel_id: channel.id,
      })
      .select("id,title,created_at")
      .single();
    if (rErr) throw new Error(rErr.message);

    return {
      analysis,
      phrases,
      report,
      timing: {
        gatherMs,
        modelMs: Math.round(performance.now() - modelStarted),
        firstWordMs,
        totalMs: Math.round(performance.now() - started),
      },
    };
  }, req.signal);
}
