import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

// Runs only when a manually captured storage state exists — see
// tests/README.md. There is no auth bypass; without the file this is skipped.
const statePath = path.join(__dirname, "..", ".auth", "state.json");
const hasState = fs.existsSync(statePath);

test.describe("authenticated app shell", () => {
  test.skip(!hasState, "tests/.auth/state.json not found — see tests/README.md");
  test.use({ storageState: hasState ? statePath : undefined });

  test("the Desk renders for a signed-in user", async ({ page }) => {
    await page.goto("/desk");
    await expect(
      page.getByRole("heading", { level: 1, name: "The Desk" })
    ).toBeVisible();
    // A signed-out visitor is bounced to /settings; staying here proves the
    // session was honored.
    await expect(page).toHaveURL(/\/desk$/);
  });
});
