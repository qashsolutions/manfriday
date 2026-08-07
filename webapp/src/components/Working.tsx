/** The client half of the analyst streaming contract: the narration a reader
    watches while the team works, and the two helpers every consuming page uses
    to read the wire format `analystStream` writes (src/lib/server/claude.ts). */

/** Why a read stopped — the server's own words for it (src/lib/server/claude.ts).
    "expected" means show the screen's designed empty state; "failure" earns the
    red banner. Routes that haven't adopted the distinction yet report failure. */
export type AnalystErrorKind = "failure" | "expected";

/** One line off an analyst stream. `done` carries whatever payload that route
    used to return in one piece. */
export type AnalystStreamEvent<T> =
  | { t: "stage"; m: string }
  | { t: "prose"; d: string }
  | { t: "error"; error: string; kind: AnalystErrorKind }
  | ({ t: "done" } & T);

/** Reads the newline-delimited events off a response body as they land. */
export async function* readAnalystStream<T>(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<AnalystStreamEvent<T>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as AnalystStreamEvent<T>;
    }
  }
  const tail = buf.trim();
  if (tail) yield JSON.parse(tail) as AnalystStreamEvent<T>;
}

/** Prose arrives token by token; repaint on a short beat instead, so a read
    that runs for half a minute doesn't cost one re-render per word. Make one
    per run — it holds that run's pending text. */
export function proseBuffer(apply: (addition: string) => void) {
  let pending = "";
  let beat: ReturnType<typeof setTimeout> | null = null;
  return {
    push(delta: string) {
      pending += delta;
      if (beat) return;
      beat = setTimeout(() => {
        beat = null;
        apply(pending);
        pending = "";
      }, 60);
    },
    flush() {
      if (beat) { clearTimeout(beat); beat = null; }
      if (pending) { apply(pending); pending = ""; }
    },
  };
}

/** The team narrating itself while it works (DESIGN.md §13).

    Every line is a step that actually ran, in the order it ran, named seat and
    present tense. The list growing IS the progress signal — there are no ticks
    and no spinner, because a tick the product can't stand behind is worse than
    no tick at all, and a spinner says nothing about who is doing what.

    The caller owns the copy and seeds the first line when it sends the request,
    so there is never an empty beat between the click and the first line back. */
export function Working({ stages }: { stages: string[] }) {
  if (!stages.length) return null;
  const done = stages.slice(0, -1);
  const now = stages[stages.length - 1];

  return (
    <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {done.map((stage, i) => (
        <div key={i} className="quiet">{stage}</div>
      ))}
      <div style={{ fontSize: 13.5, color: "var(--ink2)" }}>{now}</div>
    </div>
  );
}
