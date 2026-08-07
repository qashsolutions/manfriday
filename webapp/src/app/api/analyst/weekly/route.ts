import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { analystStream, claudeConfigured } from "@/lib/server/claude";
import { writeWeeklyReport } from "@/lib/server/weeklyReport";
import { TEAM_ATTRIBUTION, sentenceCase } from "@/lib/team";

export const maxDuration = 120;

/** On-demand weekly report. The same report also writes itself every Monday
    via the daily cron — this route is "I want it now", so it streams; the cron
    calls writeWeeklyReport with no callback and takes it whole. */
export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured yet — the service key is missing on this deployment." }, { status: 501 });
  if (!claudeConfigured()) return NextResponse.json({ error: "The analyst service isn't configured on this deployment yet." }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const seat = sentenceCase(TEAM_ATTRIBUTION.name);

  return analystStream(async (emit) => {
    const started = performance.now();
    emit.stage(`${seat} is pulling your week together…`);

    // The gather here is stored data only — no YouTube — so there is no second
    // honest stage to narrate between this one and the first written words.
    let firstWordMs: number | null = null;
    const report = await writeWeeklyReport(svc, user.id, (delta) => {
      if (firstWordMs === null) firstWordMs = Math.round(performance.now() - started);
      emit.prose(delta);
    }, emit.signal);
    if (!report) throw new Error("Connect your channel and run the first analysis first.");

    return {
      report,
      timing: { firstWordMs, totalMs: Math.round(performance.now() - started) },
    };
  }, req.signal);
}
