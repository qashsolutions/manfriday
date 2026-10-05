import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Loaded here, in the parent process, so every worker inherits it. Loading in a
// setup project only reaches that project's worker.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env.test.local", override: true, quiet: true });

/** Browser coverage for the surfaces unit tests cannot reach: every screen,
 *  link and button, including the ones behind Clerk sign-in.
 *
 *  Default target is a local dev server. Point at the live site with
 *  BASE_URL=https://manfriday.app — the signed-in specs skip themselves there,
 *  because test credentials are only ever entered against localhost. */
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(baseURL);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      dependencies: ["setup"],
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: isLocal
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
});
