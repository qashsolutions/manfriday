import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentUserId } from "./users";

// TikTok OAuth (Login Kit) — contract 3 rules: tokens exist only inside Convex;
// the Next.js callback route never sees the client secret, it just forwards
// code+state to the exchange action below.

const TIKTOK_SCOPES = "user.info.basic,video.upload,video.publish";
const REDIRECT_URI = "https://manfriday.app/api/oauth/tiktok/callback";

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Signed-in user starts a connect: mints CSRF state, returns the authorize URL.
 *  NOTE (auth policy v2): the passkey-or-2FA gate is enforced in the UI at the
 *  connect button; server-side enforcement lands with a Clerk JWT claim check. */
export const startTikTok = mutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("not signed in");
    const clientKey = env.TIKTOK_CLIENT_KEY;
    if (!clientKey) throw new Error("TikTok is not configured yet");
    const state = randomState();
    await ctx.db.insert("oauthStates", { userId, provider: "tiktok", state, used: false });
    const url =
      "https://www.tiktok.com/v2/auth/authorize/" +
      `?client_key=${encodeURIComponent(clientKey)}` +
      `&scope=${encodeURIComponent(TIKTOK_SCOPES)}` +
      "&response_type=code" +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&state=${state}`;
    return { url };
  },
});

export const consumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row || row.used) return null;
    if (Date.now() - row._creationTime > 15 * 60 * 1000) return null; // stale
    await ctx.db.patch("oauthStates", row._id, { used: true });
    return { userId: row.userId, provider: row.provider };
  },
});

export const storeAccount = internalMutation({
  args: {
    userId: v.id("users"),
    platform: v.union(v.literal("tiktok"), v.literal("youtube")),
    handle: v.string(),
    platformUserId: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx: MutationCtx, args) => {
    const existing = await ctx.db
      .query("socialAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("platform"), args.platform))
      .first();
    const fields = {
      handle: args.handle,
      platformUserId: args.platformUserId,
      avatarUrl: args.avatarUrl,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      status: "connected" as const,
    };
    if (existing) {
      await ctx.db.patch("socialAccounts", existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("socialAccounts", { userId: args.userId, platform: args.platform, ...fields });
  },
});

/** Called by the Next.js callback route with TikTok's code+state. Public action,
 *  but useless without a valid single-use state row. */
export const exchangeTikTok = action({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<{ ok: boolean; error?: string }> => {
    const stateRow: { userId: string; provider: string } | null = await ctx.runMutation(
      internal.oauth.consumeState,
      { state: args.state },
    );
    if (!stateRow) return { ok: false, error: "invalid or expired state" };

    const clientKey = env.TIKTOK_CLIENT_KEY;
    const clientSecret = env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) return { ok: false, error: "not configured" };

    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: args.code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    });
    const resp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      error?: string;
      error_description?: string;
    };
    if (!resp.ok || !data.access_token) {
      return { ok: false, error: data.error_description ?? data.error ?? `token exchange failed (${resp.status})` };
    }

    let handle = "TikTok account";
    let avatarUrl: string | undefined;
    try {
      const infoResp = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
        { headers: { Authorization: `Bearer ${data.access_token}` } },
      );
      const info = (await infoResp.json()) as { data?: { user?: { display_name?: string; avatar_url?: string } } };
      handle = info.data?.user?.display_name ?? handle;
      avatarUrl = info.data?.user?.avatar_url;
    } catch {
      // profile fetch is cosmetic; the connection still stands
    }

    await ctx.runMutation(internal.oauth.storeAccount, {
      userId: stateRow.userId as never,
      platform: "tiktok",
      handle,
      platformUserId: data.open_id,
      avatarUrl,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? "",
      expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
    });
    return { ok: true };
  },
});

export const getAccountForPublish = internalQuery({
  args: { accountId: v.id("socialAccounts") },
  handler: async (ctx: QueryCtx, args) => {
    return await ctx.db.get("socialAccounts", args.accountId);
  },
});

export const myAccounts = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("socialAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(10);
    return rows.map((a) => ({
      id: a._id,
      platform: a.platform,
      handle: a.handle,
      avatarUrl: a.avatarUrl ?? null,
      status: a.status,
    }));
  },
});

export const disconnect = mutation({
  args: { accountId: v.id("socialAccounts") },
  handler: async (ctx: MutationCtx, args) => {
    const userId = await currentUserId(ctx);
    const account = await ctx.db.get("socialAccounts", args.accountId);
    if (!account || account.userId !== userId) throw new Error("not your account");
    await ctx.db.patch("socialAccounts", args.accountId, { status: "revoked", accessToken: "", refreshToken: "" });
    return null;
  },
});
