import { describe, expect, it } from "vitest";
import { JsonStringFieldStreamer } from "@/lib/server/claude";

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
});
