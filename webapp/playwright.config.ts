import { defineConfig, devices } from "@playwright/test";

// Smoke tests only — public pages plus an optional authenticated pass
// (see tests/README.md). Port 3100 so a dev server on 3000 is untouched.
export default defineConfig({
  testDir: "./tests/e2e",
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
