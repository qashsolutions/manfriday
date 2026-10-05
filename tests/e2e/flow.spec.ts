import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

/** The path that earns the money: a pick on the feed, kept, scheduled, and then
 *  explicitly approved before anything can post. Driven against a seeded brand
 *  so it runs in seconds and costs nothing — the pipeline itself is covered by
 *  the worker tests.
 *
 *  Seed first:  npx convex run dev:seedE2E '{"email":"<E2E_TEST_EMAIL>"}'
 *  Clean up:    npx convex run dev:clearE2EFor '{"email":"<E2E_TEST_EMAIL>"}' */
const EMAIL = process.env.E2E_TEST_EMAIL;
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(
  process.env.BASE_URL ?? "http://localhost:3000",
);

test.describe.configure({ mode: "serial" });

test.describe("keep, schedule, approve", () => {
  test.skip(!EMAIL, "set E2E_TEST_EMAIL in .env.test.local");
  test.skip(!IS_LOCAL, "runs against a local dev server only");

  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto("/", { waitUntil: "load" });
    await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: EMAIL! } });
  });

  test("a pick shows its hook once, with its trend reference", async ({ page }) => {
    await page.goto("/picks", { waitUntil: "load" });

    const hook = page.getByText(/E2E fixture concept/).first();
    await expect(hook).toBeVisible();
    // The hook belongs on the card exactly once. It used to print twice: an
    // overlay on top of a thumbnail that already had it burned in.
    await expect(page.getByText(/E2E fixture concept/)).toHaveCount(1);

    // Every pick carries the proof that it is modelled on something real.
    await expect(page.getByText(/TREND REF/)).toBeVisible();
    await expect(page.getByRole("button", { name: /skip/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Keep/ })).toBeVisible();
  });

  test("keeping a pick schedules it and asks about other markets", async ({ page }) => {
    await page.goto("/picks", { waitUntil: "load" });
    await expect(page.getByText(/E2E fixture concept/).first()).toBeVisible();

    await page.getByRole("button", { name: /^Keep/ }).click();

    // The "also in" sheet offers the brand's other markets.
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/another market/i)).toBeVisible();

    // Every market is reachable, not just the three suggested tiles.
    await sheet.getByRole("button", { name: /other language/i }).click();
    const chips = sheet.locator("button").filter({ hasText: /\S/ });
    await expect.poll(async () => chips.count()).toBeGreaterThan(9);

    // Decline the extra market; the keep itself stands.
    await sheet.getByRole("button", { name: /^Just /i }).click();
    await expect(sheet).toBeHidden();
  });

  test("the kept video waits for approval and nothing posts until it is given", async ({ page }) => {
    await page.goto("/calendar", { waitUntil: "load" });

    // A kept video lands here needing an explicit yes — the YouTube attestation
    // depends on this gate, so it is a compliance check as much as a UX one.
    const banner = page.getByText(/waiting for your approval/i);
    await expect(banner).toBeVisible();

    const approve = page.getByRole("button", { name: /^Approve$/ }).first();
    await expect(approve).toBeVisible();
    await approve.click();

    // Once approved, that row stops asking.
    await expect.poll(async () => page.getByRole("button", { name: /^Approve$/ }).count()).toBe(0);
  });
});
