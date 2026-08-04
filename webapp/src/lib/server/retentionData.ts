/** Audience-retention curve + steepest-drop detection for one owned video.
    (YouTube Analytics API: audienceWatchRatio by elapsedVideoTimeRatio.) */

export type RetentionPoint = { x: number; watch: number; rel: number | null };
export type RetentionDrop = { x: number; delta: number };

export async function fetchRetention(
  accessToken: string,
  ytVideoId: string
): Promise<{ points: RetentionPoint[]; drops: RetentionDrop[] } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const url =
    `https://youtubeanalytics.googleapis.com/v2/reports` +
    `?ids=channel%3D%3DMINE&startDate=2000-01-01&endDate=${today}` +
    `&metrics=audienceWatchRatio,relativeRetentionPerformance` +
    `&dimensions=elapsedVideoTimeRatio&filters=video%3D%3D${encodeURIComponent(ytVideoId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await res.json();
  if (!res.ok) return null;

  const rows: [number, number, number | null][] = j.rows ?? [];
  const points: RetentionPoint[] = rows.map((r) => ({ x: r[0], watch: r[1], rel: r[2] ?? null }));

  // Steepest drops: biggest single-step losses, skipping the very start
  // (everyone loses viewers in the first instants), min 3% apart.
  const deltas = points
    .map((p, i) => (i === 0 ? null : { x: p.x, delta: points[i - 1].watch - p.watch }))
    .filter((d): d is RetentionDrop => d !== null && d.x > 0.03 && d.delta > 0)
    .sort((a, b) => b.delta - a.delta);
  const drops: RetentionDrop[] = [];
  for (const d of deltas) {
    if (drops.length >= 3) break;
    if (drops.every((k) => Math.abs(k.x - d.x) > 0.05)) drops.push(d);
  }
  drops.sort((a, b) => a.x - b.x);

  return { points, drops };
}

/** mm:ss label for a curve position when the duration is known. */
export function atLabel(x: number, durationSeconds: number | null): string {
  if (!durationSeconds) return `${Math.round(x * 100)}% in`;
  const s = Math.round(x * durationSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
