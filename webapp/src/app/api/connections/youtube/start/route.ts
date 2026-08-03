import { NextResponse } from "next/server";
import { webcrypto } from "node:crypto";
import { userFromRequest } from "@/lib/server/auth";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

/** Begins the "Connect your YouTube channel" flow (separate from sign-in, by design). */
export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET || !process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "YouTube connection isn't configured on this deployment yet." }, { status: 501 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const origin = new URL(req.url).origin;
  const state = Buffer.from(webcrypto.getRandomValues(new Uint8Array(24))).toString("base64url");

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", `${origin}/api/connections/youtube/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPES);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("include_granted_scopes", "true");
  auth.searchParams.set("state", state);

  const res = NextResponse.json({ url: auth.toString() });
  const cookieOpts = "Path=/; HttpOnly; SameSite=Lax; Max-Age=600";
  res.headers.append("Set-Cookie", `mf_yt_state=${state}; ${cookieOpts}`);
  res.headers.append("Set-Cookie", `mf_yt_uid=${user.id}; ${cookieOpts}`);
  return res;
}
