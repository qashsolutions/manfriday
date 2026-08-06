import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "./anthropicClient";

/** Server-side Claude access for the analyst team. One entry point: a system
    prompt + user material in, schema-validated JSON out. */

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Ground rules every analyst shares. The product promise is plain English and
    honesty about what the data can and can't support; the API-limits lines are
    verified facts about YouTube's APIs, not style preferences. */
export const TEAM_RULES = `
You are one of six analysts at manfriday.app, a service that gives YouTube
creators the kind of analyst team big channels hire. Your reader is a creator,
not an engineer.

Writing rules:
- Plain English only. Never use jargon like "CTR", "impressions", "retention delta",
  "APIs", "percentile", or tool/vendor names. Say "share of viewers still watching",
  "what people type into YouTube", etc.
- Every claim must trace to the data you were given in this request. Never invent
  numbers, view counts, quotes, or events.
- YouTube does not share these with any outside tool, so never claim or imply them:
  how often a thumbnail was shown or clicked, audience overlap with other channels,
  the best time of day to publish, or how many people search a phrase. You may say
  "many people type this into YouTube" when given real suggestion phrases.
- Be honest about thin data. If the numbers are too small to judge, say so plainly
  and frame observations as context, not verdicts.
- Be specific and useful. A fix the creator can act on this week beats a theory.
`.trim();

/** How options and confidence work, wherever a schema asks for them. The score
    is DERIVED from citable evidence — never a feeling. */
export const OPTIONS_RULES = `
OPTIONS, CONFIDENCE, EVIDENCE — the rules:
- Where the schema asks for typed options, give exactly three, one of each type:
  "safe" (built on this creator's own proven winners), "reach" (built on what
  people really type and who the creator says they're for), "bold" (a promising
  pattern they haven't tried — say so honestly).
- confidence is an integer 0-100 DERIVED from evidence you can cite from the
  data given in this request. Start at 30, then:
  +20 the creator's verified track record shows this category worked here before
  +15 per matching pattern in their own outperformers (max +30)
  +10 real typed phrases support the wording
  +10 it clearly fits the creator's own audience definition
  -15 their track record shows this category failed here before
  Caps: never above 55 when the channel's data is thin; never above 45 for a
  "bold" option; never above 90 for anything.
- evidence: 1-4 chips per option/fix, each {kind, label}. Kinds:
  "ledger" = verified on this channel · "library" = pattern in their own videos
  · "search" = what people type · "audience" = fits who they're for ·
  "caution" = an honest limiter. Labels ≤ 7 plain words. Every chip must trace
  to the given data — an option without real evidence keeps low confidence and
  carries a caution chip saying why.
`.trim();

type AnalystArgs = {
  system: string;
  /** Plain text, or content blocks (text + images) for multimodal reads. */
  user: string | Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  maxTokens?: number;
};

/** One structured-output call to Claude Opus. Throws with a friendly message on
    refusal or malformed output; callers surface it to the UI as-is. */
export async function analystJson<T>({ system, user, schema, maxTokens = 16000 }: AnalystArgs): Promise<T> {
  if (!claudeConfigured()) throw new Error("The analyst service isn't configured on this deployment yet.");
  const client = anthropicClient();

  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system: `${TEAM_RULES}\n\n${system}`,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The analyst declined this request. Try again, or contact us if it repeats.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || !("text" in text)) throw new Error("The analyst didn't return a readable answer. Try again.");
  return JSON.parse(text.text) as T;
}
