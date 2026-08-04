import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";
import { refreshChannelData } from "@/lib/server/refresh";
import { checkAppliedTips } from "@/lib/server/scorekeeper";

export const maxDuration = 300;

/** The daily run: refresh every active channel's numbers, then let the
    Scorekeeper judge applied tips. This is what makes the team "always on"
    — and what turns Ledger entries from promises into verdicts.
    Triggered by Vercel Cron (vercel.json); locked with CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "not_configured" }, { status: 501 });

  const { data: tokens } = await svc
    .from("google_oauth_tokens")
    .select("id,user_id,refresh_token_ciphertext")
    .is("revoked_at", null);
  if (!tokens || tokens.length === 0) return NextResponse.json({ users: 0, refreshed: 0, verdicts: 0 });

  const userIds = [...new Set(tokens.map((t) => t.user_id as string))];
  const { data: profs } = await svc.from("profiles").select("id,paused_at").in("id", userIds);
  const paused = new Set((profs ?? []).filter((p) => p.paused_at).map((p) => p.id as string));

  let refreshed = 0;
  let verdicts = 0;
  const errors: string[] = [];

  for (const t of tokens) {
    const uid = t.user_id as string;
    if (paused.has(uid)) continue;
    try {
      const access = await accessTokenFromRow(t.refresh_token_ciphertext as unknown as string);
      await refreshChannelData(svc, uid, access);
      refreshed++;
      verdicts += await checkAppliedTips(svc, uid);
      await svc.from("google_oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
    } catch (e) {
      errors.push(`${uid.slice(0, 8)}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({ users: userIds.length, refreshed, verdicts, errors });
}
