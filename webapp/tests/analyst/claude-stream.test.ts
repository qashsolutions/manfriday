import { describe, expect, it } from "vitest";
import { analystStream, JsonStringFieldStreamer } from "@/lib/server/claude";

/** Feeds a document through the reader in fixed-size chunks and returns
    everything it decoded. Chunk size 1 is the cruellest case: every escape,
    every key and every surrogate pair is split. */
function readIn(chunkSize: number, doc: string, field = "body_md"): string {
  const reader = new JsonStringFieldStreamer(field);
  let out = "";
  for (let i = 0; i < doc.length; i += chunkSize) out += reader.push(doc.slice(i, i + chunkSize));
  return out;
}

/** Every chunk size from 1 to the whole document at once. */
function readEveryWhichWay(doc: string, field = "body_md"): string[] {
  return Array.from({ length: doc.length }, (_, i) => readIn(i + 1, doc, field));
}

describe("JsonStringFieldStreamer", () => {
  it("lifts a field's value out of a whole document", () => {
    const doc = JSON.stringify({ title: "t", body_md: "the read", takeaways: [] });
    expect(readIn(doc.length, doc)).toBe("the read");
  });

  it("decodes the same value no matter where the chunks fall", () => {
    const value = 'Line one\n\n## Heading\n- a "quoted" bullet\\backslash\ttabbed — em dash 🎻';
    const doc = JSON.stringify({ title: "t", body_md: value, takeaways: [{ type: "safe" }] });
    for (const got of readEveryWhichWay(doc)) expect(got).toBe(value);
  });

  it("does not mistake the field name inside another value for the key", () => {
    const doc = JSON.stringify({ title: 'how "body_md" works', body_md: "real", n: 1 });
    for (const got of readEveryWhichWay(doc)) expect(got).toBe("real");
  });

  it("handles a \\uXXXX escape split across chunks", () => {
    const doc = '{"body_md":"a\\u0041b"}';
    for (const got of readEveryWhichWay(doc)) expect(got).toBe("aAb");
  });

  it("stops at the closing quote and ignores the rest of the document", () => {
    const doc = JSON.stringify({ body_md: "done here", takeaways: [{ takeaway: "not this" }] });
    const reader = new JsonStringFieldStreamer("body_md");
    let out = "";
    for (const ch of doc) out += reader.push(ch);
    expect(out).toBe("done here");
    expect(reader.done).toBe(true);
    expect(reader.push('{"body_md":"again"}')).toBe("");
  });

  it("emits nothing for a field that never arrives", () => {
    const doc = JSON.stringify({ title: "t", takeaways: [] });
    const reader = new JsonStringFieldStreamer("body_md");
    expect(reader.push(doc)).toBe("");
    expect(reader.done).toBe(false);
  });

  it("gives up quietly when the field is not a string", () => {
    const reader = new JsonStringFieldStreamer("body_md");
    expect(reader.push('{"body_md":42}')).toBe("");
    expect(reader.done).toBe(true);
  });

  it("reads a field that is not the first one in the document", () => {
    const doc = JSON.stringify({ a: "one", b: { c: "two" }, body_md: "third", d: [1, 2] });
    for (const got of readEveryWhichWay(doc)) expect(got).toBe("third");
  });

  it("takes the top-level key, not a same-named one nested deeper", () => {
    // Packaging's real shape: `one_line` at the root and again inside
    // `thumb_read`. Only the root one is the read.
    const doc = JSON.stringify({
      grade: "B+",
      one_line: "the root one",
      thumb_read: { one_line: "the nested one", works: [] },
    });
    for (const got of readEveryWhichWay(doc, "one_line")) expect(got).toBe("the root one");
  });

  it("ignores a nested key even when it arrives first", () => {
    const doc = JSON.stringify({
      thumb_read: { one_line: "the nested one" },
      one_line: "the root one",
    });
    for (const got of readEveryWhichWay(doc, "one_line")) expect(got).toBe("the root one");
  });

  it("is not fooled by braces inside string values", () => {
    const doc = JSON.stringify({
      title: "a { brace } and a [ bracket ] walk in",
      body_md: "the read",
    });
    for (const got of readEveryWhichWay(doc)) expect(got).toBe("the read");
  });
});

/** A read costs ~40s of generation. Both ways a reader can leave must stop it,
    or the bill keeps running for words nobody will ever see. */
describe("analystStream — abandoning a read stops it", () => {
  it("aborts when the request itself is aborted", async () => {
    const ac = new AbortController();
    let seen: AbortSignal | undefined;

    const res = analystStream(async (emit) => {
      seen = emit.signal;
      emit.stage("working…");
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true };
    }, ac.signal);

    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();

    expect(seen!.aborted).toBe(true);
  });

  it("aborts when the reader stops reading, even with no request abort", async () => {
    let seen: AbortSignal | undefined;

    const res = analystStream(async (emit) => {
      seen = emit.signal;
      emit.stage("working…");
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true };
    });

    const reader = res.body!.getReader();
    await reader.read();      // took the first line…
    await reader.cancel();    // …then walked away

    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(true);
  });

  it("starts already-aborted when the request was abandoned before it began", async () => {
    const ac = new AbortController();
    ac.abort();
    let seen: AbortSignal | undefined;

    const res = analystStream(async (emit) => {
      seen = emit.signal;
      return { ok: true };
    }, ac.signal);

    await new Response(res.body).text();
    expect(seen!.aborted).toBe(true);
  });

  it("writes nothing to a stream whose reader has gone", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = analystStream(async (emit) => {
      emit.stage("nobody will read this");
      emit.prose("nor this");
      return { ok: true };
    }, ac.signal);

    expect(await new Response(res.body).text()).toBe("");
  });
});

describe("JsonStringFieldStreamer — brace handling", () => {
  it("is not fooled by braces inside string values (regression)", () => {
    const doc = JSON.stringify({
      title: "a { brace } and a [ bracket ] walk in",
      body_md: "the read",
    });
    for (const got of readEveryWhichWay(doc)) expect(got).toBe("the read");
  });
});
