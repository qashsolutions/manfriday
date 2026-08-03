import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";

export async function GET(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ configured: false });

  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await svc
    .from("google_oauth_tokens")
    .select("authorized_channel_title, created_at, revoked_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ configured: true, connected: false });
  return NextResponse.json({
    configured: true,
    connected: true,
    channelTitle: data.authorized_channel_title,
    connectedAt: data.created_at,
  });
}
