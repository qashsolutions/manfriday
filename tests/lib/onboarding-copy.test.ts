import { describe, expect, test } from "vitest";
import { previewLine, stageIndex } from "../../lib/onboarding-copy";

describe("onboarding progress copy", () => {
  test("reads right at one preview and at ten", () => {
    expect(previewLine(1, 1)).toBe("Your preview is ready.");
    expect(previewLine(10, 10)).toBe("All 10 previews are ready.");
    expect(previewLine(3, 10)).toBe("3 of 10 ready — the rest are rendering.");
  });

  test("says something useful before any count exists", () => {
    expect(previewLine(0, 0)).toMatch(/rendering/);
  });

  test("the render stage finishes once every preview has landed", () => {
    expect(stageIndex("analyzing", { ready: 0, total: 0 })).toBe(0);
    expect(stageIndex("drafting", { ready: 0, total: 0 })).toBe(1);
    expect(stageIndex("done", { ready: 2, total: 10 })).toBe(2);
    expect(stageIndex("done", { ready: 10, total: 10 })).toBe(3);
    // A done request with no concepts must not claim to be finished.
    expect(stageIndex("done", { ready: 0, total: 0 })).toBe(2);
  });
});
