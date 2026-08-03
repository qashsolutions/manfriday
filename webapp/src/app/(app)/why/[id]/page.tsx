"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { loadChannelData, fmtNum, type VideoPerf, type ChannelData } from "@/lib/channelData";

export default function WhyDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<ChannelData | null>(null);

  useEffect(() => { loadChannelData().then(setData); }, []);

  if (!data) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;

  const v: VideoPerf | undefined = data.videos.find((x) => x.id === params.id || x.yt_video_id === params.id);
  if (!v) {
    return (
      <>
        <div className="pagehead"><h1>Video not found</h1></div>
        <Link className="btn btn-ghost" href="/why">Back to all videos</Link>
      </>
    );
  }

  const med = v.is_short ? data.baselines.shorts?.median_views : data.baselines.longform?.median_views;

  return (
    <>
      <div className="pagehead">
        <h1>{v.title ?? v.yt_video_id}</h1>
      </div>
      <div style={{ marginBottom: 14, color: "var(--ink3)", fontSize: 12.5 }}>
        {v.published_at ? `Published ${new Date(v.published_at).toLocaleDateString()}` : ""}
        {v.is_short ? " · Short" : ""} ·{" "}
        <a href={`https://www.youtube.com/watch?v=${v.yt_video_id}`} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>
          watch on YouTube ↗
        </a>
      </div>

      <div className="grid g3">
        <div className="card stat">
          <span className="k">Views</span>
          <div className="big num">{fmtNum(v.view_count)}</div>
          <span className="delta fl num">{v.views_per_day ? `${fmtNum(v.views_per_day)} a day` : ""}</span>
        </div>
        <div className="card stat">
          <span className="k">Normal for this format</span>
          <div className="big num">{fmtNum(med ?? null)}</div>
          <span className="delta fl">{v.is_short ? "your typical Short" : "your typical full video"}</span>
        </div>
        <div className="card stat">
          <span className="k">Verdict so far</span>
          <div className="big num">{v.ratio !== null ? `${v.ratio}×` : "—"}</div>
          {v.flag === "underperformer" && <span className="delta dn">well below your normal</span>}
          {v.flag === "outperformer" && <span className="delta up">a hit — worth studying</span>}
          {v.flag === "typical" && <span className="delta fl">about normal</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <span className="k">The deep read</span>
        <p style={{ color: "var(--ink2)", fontSize: 13, margin: "8px 0 0", maxWidth: "64ch" }}>
          This is where your Retention Analyst reads the retention curve against what you were
          saying at each moment — &quot;viewers left at 2:14, here&apos;s why&quot; — and hands you fixes with
          expected outcomes. That analyst comes online in the next build phase; the numbers above
          are already live from your channel.
        </p>
      </div>
    </>
  );
}
