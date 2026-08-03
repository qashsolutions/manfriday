"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadChannelData, fmtNum, type ChannelData } from "@/lib/channelData";

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
                  <td style={{ padding: "9px 10px" }}>
                    {v.flag === "underperformer" && <span className="pill crit">{v.ratio}× — well below</span>}
                    {v.flag === "outperformer" && <span className="pill good">{v.ratio}× — a hit</span>}
                    {v.flag === "typical" && <span className="pill mut">{v.ratio}×</span>}
                    {v.flag === null && <span className="pill mut">—</span>}
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <Link href={`/why/${v.id}`} className="btn btn-ghost btn-sm">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
