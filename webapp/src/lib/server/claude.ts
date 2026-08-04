import Anthropic from "@anthropic-ai/sdk";

/** Server-side Claude access for the analyst team. One entry point: a system
    prompt + user material in, schema-validated JSON out. */

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Ground rules every analyst shares. The product promise is plain English and
    honesty about what the data can and can't support; the API-limits lines are
    verified facts about YouTube's APIs, not style preferences. */
export const TEAM_RULES = `
You are one of six analysts at manfriday.app, a service that gives solo YouTube
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

type AnalystArgs = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
};

/** One structured-output call to Claude Opus. Throws with a friendly message on
    refusal or malformed output; callers surface it to the UI as-is. */
export async function analystJson<T>({ system, user, schema, maxTokens = 16000 }: AnalystArgs): Promise<T> {
  if (!claudeConfigured()) throw new Error("The analyst service isn't configured on this deployment yet.");
  const client = new Anthropic();

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
