import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { analystJson, claudeConfigured, OPTIONS_RULES } from "@/lib/server/claude";
import { analystGrounding } from "@/lib/server/grounding";
import { typedPhrases } from "@/lib/server/publicYt";

export const maxDuration = 120;

/** The Packaging Analyst: grades a draft title against the creator's OWN
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
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grade", "one_line", "strengths", "risks", "options", "search_note", "thin_data_note"],
  properties: {
    grade: { type: "string", enum: ["A", "A-", "B+", "B", "B-", "C+", "C", "D"] },
    one_line: { type: "string", description: "The grade's reason in one sentence — never a bare score." },
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
  },
} as const;

type BaselineDetail = {
  title: string | null;
  view_count: number | null;
  ratio_to_median: number | null;
  flag: string;
};

export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const draft: string = String(body.title ?? "").trim().slice(0, 200);
  if (!draft) return NextResponse.json({ error: "Type a draft title first." }, { status: 400 });

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

  // What people actually type — two seeds from the draft's own words.
  const words = draft.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
  const seeds = [words.slice(0, 3).join(" "), words.slice(0, 5).join(" ")].filter((s, i, a) => s && a.indexOf(s) === i);
  const phraseLists = await Promise.all(seeds.map(typedPhrases));
  const phrases = [...new Set(phraseLists.flat())].slice(0, 12);

  const thin = [...latestByFormat.values()].every((b) => b.median_views < 100 || b.sample_size < 5);
  const grounding = await analystGrounding(svc, user.id);

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

  try {
    const analysis = await analystJson<Grade>({
      system: `You are the Packaging Analyst. Grade the draft title honestly against this creator's own winners and misses — patterns in THEIR titles, not generic YouTube advice. Rewrites must sound like this creator, promise something concrete, and avoid clickbait they'd regret. Grade craft, not luck.\n\n${OPTIONS_RULES}`,
      user: userMsg,
      schema: SCHEMA as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ analysis, phrases });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The grading couldn't finish." },
      { status: 502 }
    );
  }
}
