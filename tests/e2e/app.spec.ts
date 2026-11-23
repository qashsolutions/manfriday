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

    test(`${name} screen shows guest slots and both ways to invite`, async ({ page }) => {
      await page.goto(path, { waitUntil: "load" });
      const heading = page.locator("h1");
      await expect(heading).toBeVisible();
      test.skip(/not for you/i.test((await heading.textContent()) ?? ""), "test account is not an operator");

      // The slot counter comes from guests.summary; it must say N of 10.
      await expect(page.getByText(/INVITE A GUEST · \d+ OF 10 SLOTS USED/)).toBeVisible();
      // Every slot in use shows as a row: a live guest with its deletion date,
      // or an unused invite with the day its link lapses.
      const used = Number((await page.getByText(/SLOTS USED/).textContent())!.match(/(\d+) OF/)![1]);
      await expect(page.getByText(/^(GUEST · \d+\/\d+ USED · DELETED|INVITED · LINK LAPSES) /)).toHaveCount(used);
      // Emailing is the default; unticking switches to a copyable link.
      // Neither button is pressed — that would reserve a real slot.
      const box = page.getByRole("checkbox", { name: /email the invite now/i });
      await expect(box).toBeChecked();
      await page.getByRole("textbox", { name: /email address to invite/i }).fill("someone@example.com");
      await expect(page.getByRole("button", { name: /send invite/i })).toBeEnabled();
      await box.uncheck();
      await expect(page.getByRole("button", { name: /create link/i })).toBeEnabled();
    });
  }

  test("Something wrong? lists what goes with the report: screen, pick, last error, device", async ({ page }) => {
    await page.goto("/picks", { waitUntil: "load" });
    // The seeded fixture guarantees a pick on screen.
    await expect(page.getByText(/MADE FOR YOU/).first()).toBeVisible({ timeout: 15_000 });

    // An error the app "showed" — the capture listens for these.
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "e2e: render went wrong" })));

    await page.getByRole("button", { name: "Something wrong?" }).click();
    const sheet = page.getByRole("dialog", { name: /tell us what happened/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Sent with your report")).toBeVisible();
    await expect(sheet.getByText("This screen (/picks)")).toBeVisible();
    await expect(sheet.getByText(/^The pick on screen/)).toBeVisible();
    await expect(sheet.getByText(/The last error you saw: .e2e: render went wrong./)).toBeVisible();
    await expect(sheet.getByText(/^Your device: (Chrome|Safari|Firefox|Edge|Browser)( on \w+)?, \d+×\d+$/)).toBeVisible();

    // Too short to send; three characters is enough. Not sent — every send
    // emails the team.
    const box = sheet.getByRole("textbox");
    const send = sheet.getByRole("button", { name: "Send" });
    await box.fill("ab");
    await expect(send).toBeDisabled();
    await box.fill("abc");
    await expect(send).toBeEnabled();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
  });

  test("Something wrong? on a screen without a pick does not claim one", async ({ page }) => {
    await page.goto("/picks", { waitUntil: "load" });
    await expect(page.getByText(/MADE FOR YOU/).first()).toBeVisible({ timeout: 15_000 });
    // Leave Picks inside the app, so the remembered pick has to be let go.
    await page.getByRole("link", { name: "CALENDAR", exact: true }).click();
    await expect(page).toHaveURL(/\/calendar/);

    await page.getByRole("button", { name: "Something wrong?" }).click();
    const sheet = page.getByRole("dialog", { name: /tell us what happened/i });
    await expect(sheet.getByText("This screen (/calendar)")).toBeVisible();
    await expect(sheet.getByText(/^The pick on screen/)).toHaveCount(0);
    await expect(sheet.getByText(/^The last error you saw/)).toHaveCount(0);
  });

  // Review of 23 Nov 2026: every signed-in screen was 680px wide on a phone and
  // the report button sat on top of Keep.
  test("every app screen fits a phone, and Keep is on screen and uncovered", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const { path } of [...APP_PAGES, { path: "/onboarding" }]) {
      await page.goto(path, { waitUntil: "load" });
      await expect(page.getByRole("link", { name: "PICKS", exact: true })).toBeVisible();
      await page.waitForTimeout(800); // Convex content settles after first paint
      const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(w.scroll, `${path} is ${w.scroll - w.client}px wider than the phone`).toBeLessThanOrEqual(w.client + 1);
    }
    await page.goto("/picks", { waitUntil: "load" });
    const keep = page.getByRole("button", { name: /^Keep/ });
    await expect(keep).toBeVisible({ timeout: 15_000 });
    const box = (await keep.boundingBox())!;
    expect(box.y + box.height, "Keep is below the fold").toBeLessThanOrEqual(844);
    const report = (await page.getByRole("button", { name: "Something wrong?" }).boundingBox())!;
    const overlaps = !(report.y >= box.y + box.height || report.y + report.height <= box.y || report.x >= box.x + box.width || report.x + report.width <= box.x);
    expect(overlaps, "the report button covers Keep").toBe(false);
  });

  test("a pick explains why it could work", async ({ page }) => {
    await page.goto("/picks", { waitUntil: "load" });
    const chip = page.getByRole("button", { name: /WHY\?/ });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();
    const sheet = page.getByRole("dialog", { name: "Why this pick" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/^THE SHAPE · /)).toBeVisible();
    // Either a linked original with its numbers, or an honest "starter shape" line.
    await expect(sheet.getByText(/Watch the original on|starter shapes/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("a pick's words can be edited before keeping, within their limits", async ({ page }) => {
    await page.goto("/picks", { waitUntil: "load" });
    await page.getByRole("button", { name: "Edit the words before keeping" }).click({ timeout: 15_000 });
    const sheet = page.getByRole("dialog", { name: "Edit the words" });
    const first = sheet.getByRole("textbox").first();
    await expect(first).toBeVisible();
    const save = sheet.getByRole("button", { name: "Save words" });
    await first.fill("");
    await expect(save).toBeDisabled(); // empty is refused
    await first.fill("x".repeat(400));
    await expect(save).toBeDisabled(); // over the limit is refused
    await sheet.getByRole("button", { name: "Cancel" }).click(); // nothing saved
    await expect(sheet).toHaveCount(0);
  });

  test("the brief is readable and editable in Settings", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "YOUR PRODUCT" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("FACTS FRIDAY MAY USE")).toBeVisible();
    await page.getByRole("button", { name: "Edit the brief" }).click();
    await expect(page.getByRole("radiogroup", { name: "Trends from" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Edit the brief" })).toBeVisible();
  });
});
