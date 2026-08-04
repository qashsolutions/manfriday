import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { claudeConfigured } from "@/lib/server/claude";
import { writeWeeklyReport } from "@/lib/server/weeklyReport";

export const maxDuration = 120;

/** On-demand weekly report. The same report also writes itself every Monday
    via the daily cron — this route is "I want it now". */
export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    const report = await writeWeeklyReport(svc, user.id);
    if (!report) return NextResponse.json({ error: "Connect your channel and run the first analysis first." }, { status: 400 });
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The weekly report couldn't finish." },
      { status: 502 }
    );
  }
}
