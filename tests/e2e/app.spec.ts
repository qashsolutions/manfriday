import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_PAGES, APP_PAGES } from "./routes";

/** Everything behind sign-in. Credentials come from .env.test.local and are
 *  only ever typed against a local dev server — never the live site. Without
 *  them the whole file skips rather than failing the run. */
const EMAIL = process.env.E2E_TEST_EMAIL;
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(
  process.env.BASE_URL ?? "http://localhost:3000",
);

test.describe("signed in", () => {
  test.skip(!EMAIL, "set E2E_TEST_EMAIL in .env.test.local");
  test.skip(!IS_LOCAL, "signed-in specs run against a local dev server only");

  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
    // Sign in from an ordinary page: the <SignIn/> component on /login competes
    // with the programmatic sign-in and the session never settles.
    await page.goto("/", { waitUntil: "load" });
    // The address uses Clerk's +clerk_test convention, so the emailed code is
    // the fixed test code and no real mail is sent. This does not depend on
    // password auth being enabled on the instance.
    await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: EMAIL! } });
  });

  for (const { path, name } of APP_PAGES) {
    test(`${name} loads with its navigation`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "load" });
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      // Every app screen carries the same tab bar.
      for (const label of ["PICKS", "CALENDAR", "ANALYTICS", "SETTINGS"]) {
        await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      // No screen should sit blank. Not every screen has a heading — Picks
      // shows a card when the feed has something in it — so check for real
      // content below the header rather than for an <h1>.
      // Convex queries resolve after first paint, so poll rather than read once.
      await expect
        .poll(
          async () => (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().length,
          { timeout: 15_000, message: `${path} rendered almost nothing` },
        )
        .toBeGreaterThan(150);
    });
  }

  test("the account modal opens wide enough for its two columns", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "load" });
    // Clerk's own element keys — the same handles our appearance config uses.
    const trigger = page.locator(".cl-userButtonTrigger").first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    // Clerk does not give this a menuitem role in every build, so match on text.
    await page.getByText(/manage account/i).first().click();

    const modal = page.locator(".cl-modalContent").first();
    await expect(modal).toBeVisible();
    const inner = modal.locator(".cl-cardBox").first();
    const card = (await inner.count()) > 0 ? inner : modal;
    const box = await card.boundingBox();
    // The profile is a nav rail beside a detail panel. Capped at 520px the two
    // columns overlapped and the labels clipped, which is the bug this guards.
    expect(box!.width, "account modal is too narrow — its columns will overlap").toBeGreaterThan(600);
    // And it must still fit the window.
    const vw = page.viewportSize()!.width;
    expect(box!.width, "account modal is wider than the window").toBeLessThanOrEqual(vw);
  });

  for (const { path, name } of ADMIN_PAGES) {
    test(`${name} screen is reachable and can invite`, async ({ page }) => {
      await page.goto(path, { waitUntil: "load" });
      // The screen renders nothing until the operator check resolves, so wait
      // for it to land one way or the other before deciding.
      const heading = page.locator("h1");
      await expect(heading).toBeVisible();
      test.skip(/not for you/i.test((await heading.textContent()) ?? ""), "test account is not an operator");

      await expect(page.getByRole("link", { name: "ADMIN", exact: true })).toBeVisible();
      const field = page.getByRole("textbox", { name: /email address to invite/i });
      await expect(field).toBeVisible();
      const send = page.getByRole("button", { name: /send invite/i });
      await expect(send).toBeVisible();
      // The button stays inert until the address looks like one.
      await expect(send).toBeDisabled();
      await field.fill("someone@example.com");
      await expect(send).toBeEnabled();
    });
  }
});
