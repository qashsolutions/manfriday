"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadChannelData, fmtNum, type ChannelData } from "@/lib/channelData";
import { Explain, RatioBar } from "@/components/Explain";

export default function WhyPage() {
  const [data, setData] = useState<ChannelData | null>(null);

  useEffect(() => { loadChannelData().then(setData); }, []);

  if (!data) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;

  const hasData = data.channel && data.videos.some((v) => v.ratio !== null);

  return (
    <>
      <div className="pagehead"><h1>Why videos win or die</h1></div>
      {!hasData ? (
        <div className="empty" style={{ padding: 40 }}>
          <b>Waiting on your first analysis</b>
          Once your channel is read, every video shows up here against your own normal —
          and the deep retention reads land video by video.
          <div style={{ marginTop: 14 }}>
            <Link className="btn btn-acc" href="/desk">Go to the Desk</Link>
          </div>
        </div>
      ) : (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Video", "Views", "vs normal", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink3)", fontWeight: 700, padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.videos.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid var(--line2)" }}>
                  <td style={{ padding: "9px 10px" }}>
                    <b style={{ fontSize: 13 }}>{v.title ?? v.yt_video_id}</b>
                    <div style={{ color: "var(--ink3)", fontSize: 11.5 }}>
                      {v.published_at ? new Date(v.published_at).toLocaleDateString() : ""}
                      {v.is_short ? " · Short" : ""}
                    </div>
                  </td>
                  <td className="num" style={{ padding: "9px 10px" }}>{fmtNum(v.view_count)}</td>
                  <td style={{ padding: "9px 10px", minWidth: 150 }}>
                    <RatioBar ratio={v.ratio} />
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <Link href={`/why/${v.id}`} className="btn btn-ghost btn-sm">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Explain
            why="Raw views lie — 5,000 views is a win for one channel and a flop for another."
            how="Each bar is this video against your own median for its format (the tick is your normal, 1×). Shorts and full videos are never mixed."
            what="Open the red ones to see where viewers left; study the green ones — they're your patterns to repeat."
          />
        </div>
      )}
    </>
  );
}
