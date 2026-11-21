import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { CLERK_ID, harness, seed } from "./setup";

/** Auth policy v2 (D4): passkey OR 2FA before any social account connects —
 *  enforced on the server, before the authorization code is exchanged. */

type ClerkUser = { two_factor_enabled?: boolean; passkeys?: unknown[] } | "down";

function stubNetwork(clerk: ClerkUser) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.clerk.com/v1/users/")) {
        if (clerk === "down") return new Response("unavailable", { status: 503 });
        return Response.json(clerk);
      }
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "ya29.test", refresh_token: "1//rt", expires_in: 3600 });
      }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
        return Response.json({ items: [{ id: "UC1", snippet: { title: "My channel" } }] });
      }
      if (url.startsWith("https://open.tiktokapis.com/v2/oauth/token/")) {
        return Response.json({ access_token: "act.test", refresh_token: "rft.test", expires_in: 86400, open_id: "o1" });
      }
      return Response.json({});
    }),
  );
  return calls;
}

async function startedConnect(provider: "google" | "tiktok") {
  const t = harness();
  const s = await seed(t);
  const state = `state-${provider}`;
  await t.run((ctx) => ctx.db.insert("oauthStates", { userId: s.userId, provider, state, used: false }));
  return { t, s, state };
}

/** Accounts holding tokens from this test's exchange (seed() connects its own). */
const newAccounts = (t: Awaited<ReturnType<typeof startedConnect>>["t"]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("socialAccounts").collect()).filter((a) => a.accessToken === "ya29.test" || a.accessToken === "act.test"),
  );

const tokenExchanges = (calls: string[]) =>
  calls.filter((u) => u.includes("oauth2.googleapis.com/token") || u.includes("open.tiktokapis.com/v2/oauth/token")).length;

describe("connecting needs a passkey or two-factor authentication", () => {
  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = "sk_test_fake";
    process.env.GOOGLE_CLIENT_ID = "gid";
    process.env.GOOGLE_CLIENT_SECRET = "gsecret";
    process.env.TIKTOK_CLIENT_KEY = "ck";
    process.env.TIKTOK_CLIENT_SECRET = "cs";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["CLERK_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]) delete process.env[k];
  });

  test("neither: YouTube is refused before any token is requested, and nothing is stored", async () => {
    const { t, state } = await startedConnect("google");
    const calls = stubNetwork({ two_factor_enabled: false, passkeys: [] });
    const res = await t.action(api.oauth.exchangeGoogle, { code: "c", state });
    expect(res).toEqual({ ok: false, error: "MFA_REQUIRED" });
    expect(tokenExchanges(calls)).toBe(0);
    expect(await newAccounts(t)).toHaveLength(0);
    // It asked Clerk about this user, not someone else.
    expect(calls.some((u) => u.endsWith(`/v1/users/${CLERK_ID}`))).toBe(true);
  });

  test("neither: TikTok is refused the same way", async () => {
    const { t, state } = await startedConnect("tiktok");
    const calls = stubNetwork({ two_factor_enabled: false, passkeys: [] });
    expect(await t.action(api.oauth.exchangeTikTok, { code: "c", state })).toEqual({ ok: false, error: "MFA_REQUIRED" });
    expect(tokenExchanges(calls)).toBe(0);
    expect(await newAccounts(t)).toHaveLength(0);
  });

  test("a passkey alone is enough", async () => {
    const { t, state } = await startedConnect("google");
    stubNetwork({ two_factor_enabled: false, passkeys: [{ id: "pk_1" }] });
    expect(await t.action(api.oauth.exchangeGoogle, { code: "c", state })).toEqual({ ok: true });
    const [acct] = await newAccounts(t);
    expect(acct.platform).toBe("youtube");
    expect(acct.handle).toBe("My channel");
  });

  test("two-factor alone is enough", async () => {
    const { t, state } = await startedConnect("tiktok");
    stubNetwork({ two_factor_enabled: true, passkeys: [] });
    expect(await t.action(api.oauth.exchangeTikTok, { code: "c", state })).toEqual({ ok: true });
    expect(await newAccounts(t)).toHaveLength(1);
  });

  test("if Clerk can't be asked, the connect is refused (fails closed)", async () => {
    const { t, state } = await startedConnect("google");
    const calls = stubNetwork("down");
    expect(await t.action(api.oauth.exchangeGoogle, { code: "c", state })).toEqual({ ok: false, error: "MFA_UNVERIFIED" });
    expect(tokenExchanges(calls)).toBe(0);
    expect(await newAccounts(t)).toHaveLength(0);
  });

  test("without the Clerk key configured, the connect is refused", async () => {
    const { t, state } = await startedConnect("google");
    delete process.env.CLERK_SECRET_KEY;
    const calls = stubNetwork({ two_factor_enabled: true });
    expect(await t.action(api.oauth.exchangeGoogle, { code: "c", state })).toEqual({ ok: false, error: "MFA_UNVERIFIED" });
    expect(calls).toHaveLength(0);
  });

  test("a refused connect burns its state: retrying the same callback doesn't get through", async () => {
    const { t, state } = await startedConnect("google");
    stubNetwork({ two_factor_enabled: false, passkeys: [] });
    await t.action(api.oauth.exchangeGoogle, { code: "c", state });
    stubNetwork({ two_factor_enabled: true });
    expect(await t.action(api.oauth.exchangeGoogle, { code: "c", state })).toEqual({ ok: false, error: "invalid or expired state" });
  });
});
