import { describe, expect, test } from "vitest";
import { LANGUAGE_META, searchLanguages, suggestMarkets } from "../../lib/languages";

/** The "also in" sheet lets a user reach EVERY market, not just the three
 *  Friday suggests. It used to cap the list at 6, which hid half of them. */
describe("browsing every market", () => {
  test("an empty query lists every launch language", () => {
    expect(searchLanguages("").length).toBe(LANGUAGE_META.length);
    expect(LANGUAGE_META.length).toBe(14);
  });

  test("the sheet's own filtering still leaves more than the three tiles", () => {
    const primary = "en";
    const suggested = new Set(suggestMarkets(primary, null).map((l) => l.code));
    const browsable = searchLanguages("").filter((l) => l.code !== primary && !suggested.has(l.code));
    // 14 total, minus English, minus the three tiles.
    expect(browsable.length).toBe(LANGUAGE_META.length - 1 - suggested.size);
    expect(browsable.length).toBeGreaterThan(6);
  });

  test("typing still ranks the obvious match first", () => {
    expect(searchLanguages("ta")[0].code).toBe("ta");
    expect(searchLanguages("portug")[0].code).toBe("pt-BR");
  });

  test("a typed query keeps suggested languages visible", () => {
    const hits = searchLanguages("spanish");
    expect(hits.some((l) => l.code === "es")).toBe(true);
  });
});
