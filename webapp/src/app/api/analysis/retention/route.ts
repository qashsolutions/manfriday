import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { fetchRetention } from "@/lib/server/retentionData";

/** Real audience-retention curve for one of the user's own videos.
    Drop detection is pure arithmetic — the steepest losses along the curve. */
export async function GET(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const videoId = new URL(req.url).searchParams.get("video");
  if (!videoId) return NextResponse.json({ error: "Missing video id" }, { status: 400 });

  const { data: tokenRow } = await svc
    .from("google_oauth_tokens")
    .select("refresh_token_ciphertext")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!tokenRow) return NextResponse.json({ error: "No channel connected" }, { status: 400 });

  try {
    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);
    const ret = await fetchRetention(access, videoId);
    if (!ret) return NextResponse.json({ error: "retention_unavailable" }, { status: 502 });
    return NextResponse.json(ret);
  } catch {
    return NextResponse.json({ error: "retention_unavailable" }, { status: 502 });
  }
}
