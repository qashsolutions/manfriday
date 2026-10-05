import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test.local", override: true, quiet: true });

/** Fetches a Clerk testing token so sign-in flows are not blocked by bot
 *  protection. Harmless when the keys are absent — the signed-in specs skip. */
setup("clerk", async () => {
  if (!process.env.CLERK_SECRET_KEY) {
    console.warn("CLERK_SECRET_KEY absent — signed-in specs will skip");
    return;
  }
  await clerkSetup();
});
