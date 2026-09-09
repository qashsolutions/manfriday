import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// Google redirects here with ?code&state. Same contract as the TikTok route:
// no secrets here — the Convex action validates the single-use state and does
// the token exchange where the client secret lives.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  const base = new URL("/settings", req.nextUrl.origin);

  if (errorParam || !code || !state) {
    base.searchParams.set("connect", "youtube_denied");
    return NextResponse.redirect(base);
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    base.searchParams.set("connect", "config_missing");
    return NextResponse.redirect(base);
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const result = await client.action(api.oauth.exchangeGoogle, { code, state });
    base.searchParams.set("connect", result.ok ? "youtube_ok" : "youtube_failed");
  } catch {
    base.searchParams.set("connect", "youtube_failed");
  }
  return NextResponse.redirect(base);
}
