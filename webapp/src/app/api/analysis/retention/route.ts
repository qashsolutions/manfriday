import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { accessTokenFromRow } from "@/lib/server/youtube";

/** Real audience-retention curve for one of the user's own videos
    (YouTube Analytics API: audienceWatchRatio by elapsedVideoTimeRatio).
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
    const today = new Date().toISOString().slice(0, 10);
    const url =
      `https://youtubeanalytics.googleapis.com/v2/reports` +
      `?ids=channel%3D%3DMINE&startDate=2000-01-01&endDate=${today}` +
      `&metrics=audienceWatchRatio,relativeRetentionPerformance` +
      `&dimensions=elapsedVideoTimeRatio&filters=video%3D%3D${encodeURIComponent(videoId)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
    const j = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: "retention_unavailable" }, { status: 502 });
    }
    const rows: [number, number, number | null][] = j.rows ?? [];
    if (rows.length === 0) {
      return NextResponse.json({ points: [], drops: [] });
    }
    const points = rows.map((r) => ({ x: r[0], watch: r[1], rel: r[2] ?? null }));

    // Steepest drops: biggest single-step losses, skipping the very start
    // (everyone loses viewers in the first instants), min 3% apart.
    const deltas = points
      .map((p, i) => (i === 0 ? null : { x: p.x, delta: points[i - 1].watch - p.watch }))
      .filter((d): d is { x: number; delta: number } => d !== null && d.x > 0.03 && d.delta > 0)
      .sort((a, b) => b.delta - a.delta);
    const drops: { x: number; delta: number }[] = [];
    for (const d of deltas) {
      if (drops.length >= 3) break;
      if (drops.every((k) => Math.abs(k.x - d.x) > 0.05)) drops.push(d);
    }
    drops.sort((a, b) => a.x - b.x);

    return NextResponse.json({ points, drops });
  } catch {
    return NextResponse.json({ error: "retention_unavailable" }, { status: 502 });
  }
}
