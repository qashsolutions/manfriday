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

/* ── The streaming path ───────────────────────────────────────────────────
   A read takes the analyst tens of seconds to write, and that length is the
   product — so instead of shortening it we hand it over as it is written. The
   pieces: a scanner that lifts one field's prose out of half-arrived JSON, the
   streaming call itself, and the wire format the pages read. */

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
const WS = new Set([" ", "\n", "\t", "\r"]);

/** Lifts the decoded value of one named string field out of a JSON document
    that is still arriving, chunk by arbitrary chunk.

    Matching is done with a real (if small) JSON scan rather than a substring
    search, so a field name that also appears inside some other value — a
    report titled "how body_md works" — can't be mistaken for the key. Anything
    it can't yet decode unambiguously, notably an escape sequence split across
    two chunks, is held back until the next chunk completes it. */
export class JsonStringFieldStreamer {
  private phase: "scan" | "colon" | "quote" | "value" | "done" = "scan";
  private buf = "";
  private inString = false;
  private esc = false;
  private token = "";
  private readonly field: string;

  constructor(field: string) {
    this.field = field;
  }

  get done(): boolean {
    return this.phase === "done";
  }

  /** Feeds the next raw chunk; returns whatever new decoded text that made
      readable (often ""). */
  push(chunk: string): string {
    this.buf += chunk;
    let out = "";

    while (this.buf.length) {
      if (this.phase === "done") break;

      if (this.phase === "value") {
        const c = this.buf[0];
        if (this.esc) {
          if (c === "u") {
            if (this.buf.length < 5) break; // need all four hex digits
            out += String.fromCharCode(parseInt(this.buf.slice(1, 5), 16));
            this.buf = this.buf.slice(5);
          } else {
            out += ESCAPES[c] ?? c;
            this.buf = this.buf.slice(1);
          }
          this.esc = false;
          continue;
        }
        if (c === "\\") {
          if (this.buf.length < 2) break; // hold: the escaped char is next chunk
          this.esc = true;
          this.buf = this.buf.slice(1);
          continue;
        }
        if (c === '"') {
          this.phase = "done";
          break;
        }
        out += c;
        this.buf = this.buf.slice(1);
        continue;
      }

      const c = this.buf[0];
      this.buf = this.buf.slice(1);

      if (this.phase === "quote") {
        if (WS.has(c)) continue;
        // A non-string value where we expected prose: nothing to stream.
        this.phase = c === '"' ? "value" : "done";
        continue;
      }

      if (this.phase === "colon") {
        if (WS.has(c)) continue;
        if (c === ":") {
          this.phase = "quote";
          continue;
        }
        this.phase = "scan"; // not a key after all — re-read c below
      }

      if (this.inString) {
        if (this.esc) {
          this.esc = false;
          this.token += c;
        } else if (c === "\\") {
          this.esc = true;
        } else if (c === '"') {
          this.inString = false;
          if (this.token === this.field) this.phase = "colon";
          this.token = "";
        } else {
          this.token += c;
        }
        continue;
      }
      if (c === '"') {
        this.inString = true;
        this.token = "";
      }
    }

    if (this.phase === "done") this.buf = "";
    return out;
  }
}

type AnalystStreamArgs = AnalystArgs & {
  /** The schema field whose prose to hand over as it is written — the one the
      read opens with, so the first seconds carry the summary. */
  proseField: string;
  onProse: (delta: string) => void;
};

/** The same structured-output call as `analystJson` — same model, same betas,
    same fallbacks, same validated JSON at the end — except the analyst's prose
    is handed to `onProse` while it is still being written. */
export async function analystJsonStream<T>({
  system, user, schema, maxTokens = 16000, proseField, onProse,
}: AnalystStreamArgs): Promise<T> {
  if (!claudeConfigured()) throw new Error("The analyst service isn't configured on this deployment yet.");
  const client = anthropicClient();

  const stream = client.beta.messages.stream({
    model: "claude-opus-5",
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system: `${TEAM_RULES}\n\n${system}`,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  });

  const prose = new JsonStringFieldStreamer(proseField);
  for await (const event of stream) {
    if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
    if (prose.done) continue;
    const text = prose.push(event.delta.text);
    if (text) onProse(text);
  }

  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new Error("The analyst declined this request. Try again, or contact us if it repeats.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || !("text" in text)) throw new Error("The analyst didn't return a readable answer. Try again.");
  return JSON.parse(text.text) as T;
}

/** What a page hands the analyst back: named, present-tense progress while the
    team gathers, then the prose as it lands. */
export type AnalystEmit = {
  /** One truthful line about the step now running — never a fake tick. */
  stage: (message: string) => void;
  prose: (delta: string) => void;
};

/** Runs an analyst and returns its whole progress as newline-delimited JSON:
    `stage` lines while the team gathers, `prose` deltas while it writes, and a
    final `done` line carrying exactly the payload the route used to return in
    one piece.

    The split on failures is deliberate. A route's own guards — not signed in,
    no channel connected, nothing asked — run BEFORE this and still answer with
    a status code, because nothing has been sent yet. Once the stream opens the
    status is already on the wire, so anything that breaks after arrives in-band
    as an `error` line and the page shows it the same way. */
export function analystStream(
  run: (emit: AnalystEmit) => Promise<Record<string, unknown>>
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const done = await run({
          stage: (message) => write({ t: "stage", m: message }),
          prose: (delta) => write({ t: "prose", d: delta }),
        });
        write({ t: "done", ...done });
      } catch (e) {
        write({ t: "error", error: e instanceof Error ? e.message : "The read couldn't finish." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Keep proxies from buffering the read back into one lump.
      "X-Accel-Buffering": "no",
    },
  });
}
