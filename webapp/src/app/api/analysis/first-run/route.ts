import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { refreshChannelData } from "@/lib/server/refresh";

/** First mechanical read of a connected channel — same engine as the daily
    run (lib/server/refresh.ts), triggered by the user's button. */
export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: tokenRow } = await svc
    .from("google_oauth_tokens")
    .select("id, refresh_token_ciphertext")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!tokenRow) return NextResponse.json({ error: "No channel is connected yet." }, { status: 400 });

  try {
    const access = await accessTokenFromRow(tokenRow.refresh_token_ciphertext as unknown as string);
    const result = await refreshChannelData(svc, user.id, access);
    await svc.from("google_oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tokenRow.id);
    if (result.videos === 0) {
      return NextResponse.json({ ok: true, videos: 0, note: "No uploads found on the channel yet." });
    }
    return NextResponse.json({
      ok: true,
      videos: result.videos,
      longform_median: result.longform_median,
      shorts_median: result.shorts_median,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "First analysis failed." },
      { status: 502 }
    );
  }
}
