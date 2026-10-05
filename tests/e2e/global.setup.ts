import { execFileSync } from "node:child_process";
import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

/** Fetches a Clerk testing token so sign-in is not blocked by bot protection,
 *  and reseeds the fixture the flow specs consume. Both are no-ops when the
 *  keys or the test account are absent — those specs skip instead of failing. */
setup("clerk", async () => {
  if (!process.env.CLERK_SECRET_KEY) {
    console.warn("CLERK_SECRET_KEY absent — signed-in specs will skip");
    return;
  }
  await clerkSetup();
});

const EMAIL = process.env.E2E_TEST_EMAIL;
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(
  process.env.BASE_URL ?? "http://localhost:3000",
);

setup("seed the flow fixture", async () => {
  setup.skip(!EMAIL || !IS_LOCAL, "no test account, or not running against a local server");
  // The keep and approve specs consume their fixture, so every run starts from
  // a known state. seedE2E clears what it made before remaking it.
  execFileSync(
    "npx",
    ["convex", "run", "dev:seedE2E", JSON.stringify({ email: EMAIL, concepts: 3 })],
    { stdio: "pipe", timeout: 120_000 },
  );
});
