import { env } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

/** Return a usable Google access token for the account, refreshing it when it
 *  is within a minute of expiry. Returns null — after wiping the stored tokens
 *  (markAuthExpired) — when Google refuses the refresh: the grant is dead and
 *  the user must reconnect through the consent screen. Shared by publishing
 *  (videos.insert) and stats (videos.list) so both obey the same retention rule. */
export async function ensureGoogleAccessToken(
  ctx: ActionCtx,
  account: Doc<"socialAccounts">,
): Promise<{ token: string } | { token: null; reason: string }> {
  if (account.status !== "connected" || !account.accessToken) {
    return { token: null, reason: "account not connected" };
  }
  if (account.expiresAt >= Date.now() + 60_000) return { token: account.accessToken };
  if (!account.refreshToken) {
    await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
    return { token: null, reason: "no refresh token" };
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: account.refreshToken,
    grant_type: "refresh_token",
  });
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const r = (await resp.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!resp.ok || !r.access_token) {
    await ctx.runMutation(internal.oauth.markAuthExpired, { accountId: account._id });
    return { token: null, reason: `refresh failed (${r.error ?? resp.status})` };
  }
  await ctx.runMutation(internal.oauth.updateTokens, {
    accountId: account._id,
    accessToken: r.access_token,
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
  });
  return { token: r.access_token };
}
