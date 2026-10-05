import { expect, test, type Page } from "@playwright/test";
import { PUBLIC_FEEDS, PUBLIC_PAGES } from "./routes";

/** Noise every page emits that says nothing about our code. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /clerk.*development/i,
  /\[Fast Refresh\]/i,
  /Failed to load resource.*favicon/i,
  // Next's dev-only hot-reload socket. Never present in a production build.
  /_next\/hmr/i,
  /WebSocket connection to .*failed/i,
];

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((r) => r.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test.describe("public pages", () => {
  for (const { path, name } of PUBLIC_PAGES) {
    test(`${name} renders, titles itself and logs no errors`, async ({ page }) => {
      const errors = watchConsole(page);
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `${path} status`).toBeLessThan(400);

      await expect(page).toHaveTitle(/.{3,}/);
      // Something has to be the page's headline.
      await expect(page.locator("h1, h2").first()).toBeVisible();
      // The brand always gets the viewer home.
      await expect(page.getByRole("link", { name: /man friday home/i })).toBeVisible();

      await page.waitForTimeout(600);
      expect(errors, `console errors on ${path}`).toEqual([]);
    });
  }

  for (const feed of PUBLIC_FEEDS) {
    test(`${feed} is served`, async ({ request }) => {
      const res = await request.get(feed);
      expect(res.status(), feed).toBeLessThan(400);
      expect((await res.text()).length, `${feed} is empty`).toBeGreaterThan(20);
    });
  }

  test("no internal link anywhere public is broken", async ({ page, request }) => {
    const seen = new Set<string>();
    for (const { path } of PUBLIC_PAGES) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const hrefs = await page.locator("a[href]").evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
      for (const h of hrefs) {
        if (!h.startsWith("/") || h.startsWith("//")) continue;
        seen.add(h.split("#")[0] || "/");
      }
    }
    expect(seen.size, "found no internal links at all").toBeGreaterThan(5);

    const broken: string[] = [];
    for (const href of seen) {
      const res = await request.get(href, { maxRedirects: 5 });
      // Signed-out app routes answer 404 by design (auth.protect).
      const ok = res.status() < 400 || res.status() === 404;
      if (!ok) broken.push(`${href} → ${res.status()}`);
    }
    expect(broken, "broken internal links").toEqual([]);
  });

  test("the landing page's primary call to action accepts a URL", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const input = page.locator('input[type="url"], input[placeholder*="yourproduct" i]').first();
    await expect(input).toBeVisible();
    await input.fill("https://example.com");
    await expect(input).toHaveValue("https://example.com");
  });

  test("the theme toggle flips the document and remembers the choice", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const mode = () => page.evaluate(() => document.documentElement.dataset.mode ?? "dark");
    // Dark is the absence of the attribute; light stamps data-mode="light".
    const toggle = page.getByRole("button", { name: /switch to (light|dark) mode/i });
    await expect(toggle).toBeVisible();

    const before = await mode();
    // A click before React hydrates is swallowed, so retry until one lands.
    let after = before;
    for (let attempt = 0; attempt < 5 && after === before; attempt++) {
      await toggle.click();
      await page.waitForTimeout(400);
      after = await mode();
    }
    expect(after, "toggle never changed the document mode").not.toBe(before);

    // The choice survives a reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(mode).toBe(after);
  });
});

test.describe("invitation flow", () => {
  test("a ticket aimed at a protected page lands on sign-up", async ({ page }) => {
    await page.goto("/onboarding?__clerk_ticket=playwright-probe", { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe("/signup");
    expect(new URL(page.url()).searchParams.get("__clerk_ticket")).toBe("playwright-probe");
    await expect(page.getByText(/you.re invited/i)).toBeVisible();
  });

  test("without a ticket sign-up still shows the waitlist", async ({ page }) => {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/you.re invited/i)).toHaveCount(0);
  });
});
