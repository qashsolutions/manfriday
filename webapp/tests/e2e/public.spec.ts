import { test, expect } from "@playwright/test";

test("landing page renders its headline", async ({ page }) => {
  await page.goto("/");
  // The one sentence the page exists to say: first the why, then the next,
  // then the score. If this string drifts, the story drifted.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "First we tell you why. Then we coach what's next — and keep score."
  );
});

test("landing page tells the two steps and the score", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 2, name: "First the why. Then the next. Then the score." })
  ).toBeVisible();
});

test("terms page renders", async ({ page }) => {
  await page.goto("/terms");
  await expect(
    page.getByRole("heading", { level: 1, name: "Terms of service" })
  ).toBeVisible();
});

test("privacy page renders", async ({ page }) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy policy" })
  ).toBeVisible();
});
