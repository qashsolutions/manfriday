import { test, expect } from "@playwright/test";

test("landing page renders its headline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Big channels have an analyst team."
  );
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
