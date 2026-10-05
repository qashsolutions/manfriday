import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_PAGES, APP_PAGES } from "./routes";

/** Everything behind sign-in. Credentials come from .env.test.local and are
 *  only ever typed against a local dev server — never the live site. Without
 *  them the whole file skips rather than failing the run. */
const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(
  process.env.BASE_URL ?? "http://localhost:3000",
);

test.describe("signed in", () => {
  test.skip(!EMAIL || !PASSWORD, "set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in .env.test.local");
  test.skip(!IS_LOCAL, "signed-in specs run against a local dev server only");

  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto("/login", { waitUntil: "load" });
    await clerk.signIn({
      page,
      signInParams: { strategy: "password", identifier: EMAIL!, password: PASSWORD! },
    });
  });

  for (const { path, name } of APP_PAGES) {
    test(`${name} loads with its navigation`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "load" });
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      // Every app screen carries the same tab bar.
      for (const label of ["PICKS", "CALENDAR", "ANALYTICS", "SETTINGS"]) {
        await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      // No screen should sit empty.
      await expect(page.locator("h1, h2").first()).toBeVisible();
    });
  }

  test("the account modal opens wide enough to read", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "load" });
    await page.getByRole("button", { name: /open user button|account/i }).first().click();
    await page.getByRole("menuitem", { name: /manage account/i }).click();
    const card = page.locator(".cl-modalContent, [role='dialog']").first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    // The two-column profile layout needs real width; 520px is where it broke.
    expect(box!.width, "account modal is too narrow — columns will overlap").toBeGreaterThan(600);
  });

  for (const { path, name } of ADMIN_PAGES) {
    test(`${name} screen is reachable and can invite`, async ({ page }) => {
      await page.goto(path, { waitUntil: "load" });
      const denied = await page.getByText(/not for you/i).count();
      test.skip(denied > 0, "test account is not an operator");
      await expect(page.getByRole("link", { name: "ADMIN", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /send invite/i })).toBeVisible();
    });
  }
});
