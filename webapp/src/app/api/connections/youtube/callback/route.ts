import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/server/service";
import { encryptToken } from "@/lib/server/crypto";

/** Google redirects here after channel consent. Stores the encrypted refresh
    token and records the authorized channel, then returns to Settings. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/settings?yt_error=${encodeURIComponent(reason)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("mf_yt_state")?.value;
  const uid = req.cookies.get("mf_yt_uid")?.value;

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!);
  if (!code || !state || !cookieState || state !== cookieState || !uid) {
    return fail("state_mismatch");
  }

  const svc = serviceClient();
  if (!svc) return fail("not_configured");

  // Exchange the code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/api/connections/youtube/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) return fail("token_exchange_failed");

  // Identify the authorized channel.
  let channelId: string | null = null;
  let channelTitle: string | null = null;
  try {
    const chRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const ch = await chRes.json();
    const item = ch.items?.[0];
    if (item) {
      channelId = item.id ?? null;
      channelTitle = item.snippet?.title ?? null;
      if (channelId) {
        await svc.from("channels").upsert(
          {
            user_id: uid,
            yt_channel_id: channelId,
            title: channelTitle,
            handle: item.snippet?.customUrl ?? null,
            is_owned: true,
            subscriber_count: item.statistics?.subscriberCount
              ? Number(item.statistics.subscriberCount)
              : null,
            stats_refreshed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,yt_channel_id" }
        );
      }
    }
  } catch {
    // Channel lookup is best-effort; the token is the critical part.
  }

  const ciphertextB64 = await encryptToken(tokens.refresh_token);
  const sub: string = tokens.id_token
    ? (JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64").toString()).sub ?? "unknown")
    : "unknown";

  const { error } = await svc.from("google_oauth_tokens").upsert(
    {
      user_id: uid,
      google_sub: sub,
      refresh_token_ciphertext: `\\x${Buffer.from(ciphertextB64, "base64").toString("hex")}`,
      scopes: ["youtube.readonly", "yt-analytics.readonly"],
      authorized_channel_id: channelId,
      authorized_channel_title: channelTitle,
      revoked_at: null,
      last_used_at: null,
    },
    { onConflict: "user_id,google_sub" }
  );
  if (error) return fail("store_failed");

  const res = NextResponse.redirect(`${origin}/settings?connected=1`);
  res.headers.append("Set-Cookie", "mf_yt_state=; Path=/; Max-Age=0");
  res.headers.append("Set-Cookie", "mf_yt_uid=; Path=/; Max-Age=0");
  return res;
}
