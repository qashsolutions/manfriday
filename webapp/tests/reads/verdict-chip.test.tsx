/** The verdict chip, four states (DESIGN.md §7, extended 2026-08-07).

    The rule this file exists to hold: colour is earned. Only a result measured
    on real viewers — or run by YouTube itself — may wear a semantic colour. A
    views-only move renders in neutral ink however big it is, because a
    channel's views swing on their own, and a creator-reported result never
    renders without the words saying who reported it.

    A signed-in production account can't be made to show all four on demand, so
    the states are proved here, at the component. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VerdictChip, verdictChip, type VerdictKind } from "@/components/Verdict";

const html = (verdict: any, kind: VerdictKind | null, extra?: Record<string, unknown>) =>
  renderToStaticMarkup(<VerdictChip verdict={verdict} kind={kind} {...extra} />);

describe("the four verdict states", () => {
  it("1 · viewers stayed — measured on the curve, so colour is earned", () => {
    const out = html("worked", "viewers_stayed");
    expect(out).toContain("pill good");
    expect(out).toContain("✓ viewers stayed longer");
    expect(html("mixed", "viewers_stayed")).toContain("pill warn");
    expect(html("failed", "viewers_stayed")).toContain("pill crit");
    expect(html("failed", "viewers_stayed")).toContain("✕ viewers left sooner");
  });

  it("2 · head to head — YouTube measured it, the creator reported it, and it says so", () => {
    const won = html("worked", "head_to_head");
    expect(won).toContain("pill good");
    expect(won).toContain("✓ YouTube&#x27;s test picked this");
    // The provenance is not optional: the chip never ships alone.
    expect(won).toContain("you reported this");
    expect(html("failed", "head_to_head")).toContain("✕ YouTube&#x27;s test picked another");
    expect(html("failed", "head_to_head")).toContain("you reported this");
  });

  it("3 · what happened — never a semantic colour, however big the move", () => {
    for (const v of ["worked", "mixed", "failed"] as const) {
      const out = html(v, "what_happened");
      expect(out).toContain("pill mut");
      expect(out).not.toContain("pill good");
      expect(out).not.toContain("pill crit");
      expect(out).not.toContain("pill warn");
      expect(out).toContain("what happened, not why");
      expect(out).not.toContain("you reported this");
    }
    expect(html("worked", "what_happened")).toContain("views up");
    expect(html("failed", "what_happened")).toContain("views down");
    expect(html("mixed", "what_happened")).toContain("views held steady");
  });

  it("4 · too early — a first-class answer in neutral ink, with the clock while it waits", () => {
    expect(html("unclear", "too_early")).toContain("pill mut");
    expect(html("unclear", "too_early")).toContain("too early to judge");
    expect(html(null, null, { appliedDay: 3, judgeAfterDays: 7 })).toContain("too early to judge — day 3 of 7");
    // Thin data is not a warning state.
    expect(html("unclear", "too_early")).not.toContain("pill warn");
  });

  it("reads a row stored before kinds existed as the weakest claim it could make", () => {
    // Every one of these was judged on view counts alone. They render as what
    // they were — never upgraded to a result, never dropped from the ledger.
    expect(verdictChip("worked", null)).toEqual({ cls: "mut", label: "views up — what happened, not why" });
    expect(verdictChip("failed", null)).toEqual({ cls: "mut", label: "views down — what happened, not why" });
    expect(verdictChip("mixed", null)).toEqual({ cls: "mut", label: "views held steady — what happened, not why" });
    expect(verdictChip("unclear", null)).toEqual({ cls: "mut", label: "too early to judge" });
  });

  it("only the two measured kinds can ever wear a colour", () => {
    const coloured: string[] = [];
    for (const kind of ["viewers_stayed", "head_to_head", "what_happened", "too_early", null] as const) {
      for (const v of ["worked", "mixed", "failed", "unclear", null] as const) {
        if (verdictChip(v, kind).cls !== "mut") coloured.push(`${kind}/${v}`);
      }
    }
    expect(coloured.sort()).toEqual([
      "head_to_head/failed", "head_to_head/mixed", "head_to_head/worked",
      "viewers_stayed/failed", "viewers_stayed/mixed", "viewers_stayed/worked",
    ]);
  });
});
