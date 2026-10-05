import { describe, expect, test } from "vitest";
import { safeRedirectPath } from "../../lib/safe-redirect";

/** The sign-in page feeds this straight into Clerk's forceRedirectUrl, so an
 *  absolute URL that survives validation is an open redirect. */
describe("safeRedirectPath", () => {
  test("keeps the path a protected page asked for", () => {
    expect(safeRedirectPath("/admin")).toBe("/admin");
    expect(safeRedirectPath("/calendar?day=3")).toBe("/calendar?day=3");
  });

  test("accepts our own absolute URL and reduces it to a path", () => {
    expect(safeRedirectPath("https://manfriday.app/admin")).toBe("/admin");
    expect(safeRedirectPath("https://manfriday.app/settings#s-plan")).toBe("/settings#s-plan");
  });

  test("refuses another site", () => {
    expect(safeRedirectPath("https://evil.example/admin")).toBeUndefined();
    expect(safeRedirectPath("http://manfriday.app.evil.example/")).toBeUndefined();
  });

  test("refuses protocol-relative and scheme tricks", () => {
    expect(safeRedirectPath("//evil.example")).toBeUndefined();
    expect(safeRedirectPath("/\\evil.example")).toBeUndefined();
    expect(safeRedirectPath("javascript:alert(1)")).toBeUndefined();
    expect(safeRedirectPath("data:text/html,x")).toBeUndefined();
  });

  test("absent or unparsable means no override", () => {
    expect(safeRedirectPath(undefined)).toBeUndefined();
    expect(safeRedirectPath("")).toBeUndefined();
    expect(safeRedirectPath("not a url")).toBeUndefined();
  });

  test("takes the first value when the param repeats", () => {
    expect(safeRedirectPath(["/admin", "/picks"])).toBe("/admin");
  });
});
