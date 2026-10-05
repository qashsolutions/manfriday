import { expect, test } from "@playwright/test";
import { PUBLIC_PAGES } from "./routes";

/** Runs in the iPhone project. The product is web-only and mobile-first, so a
 *  page that scrolls sideways on a phone is a bug, not a nitpick. */
test.describe("phone width", () => {
  for (const { path, name } of PUBLIC_PAGES) {
    test(`${name} does not scroll sideways`, async ({ page }) => {
      await page.goto(path, { waitUntil: "load" });
      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        return { scrollW: d.scrollWidth, clientW: d.clientWidth };
      });
      // One pixel of slack for sub-pixel rounding.
      expect(
        overflow.scrollW,
        `${path} is ${overflow.scrollW - overflow.clientW}px wider than the screen`,
      ).toBeLessThanOrEqual(overflow.clientW + 1);
    });
  }

  test("the header keeps its call to action on one line", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const cta = page.locator("header a").filter({ hasText: /start free|open friday/i }).first();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box, "header CTA has no box").not.toBeNull();
    // A wrapped pill grows tall and narrow; a single line stays wider than tall.
    expect(box!.width, "header CTA wrapped onto multiple lines").toBeGreaterThan(box!.height);
  });
});
