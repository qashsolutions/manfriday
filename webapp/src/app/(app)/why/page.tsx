"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadChannelData, fmtNum, type ChannelData } from "@/lib/channelData";
import { Explain, RatioBar, Thumb } from "@/components/Explain";
import { ReadFailed } from "@/components/ReadFailed";

/** Which screen the numbers earn. `unreachable` comes first and on its own:
    a read that failed is not a channel with nothing in it. */
export type WhyView = "unreachable" | "empty" | "ready";

export function whyView(data: ChannelData): WhyView {
  if (data.failed) return "unreachable";
  return data.channel && data.videos.some((v) => v.ratio !== null) ? "ready" : "empty";
}

export default function WhyPage() {
  const [data, setData] = useState<ChannelData | null>(null);

  const load = () => { setData(null); loadChannelData().then(setData); };
  useEffect(() => { loadChannelData().then(setData); }, []);

  if (!data) return <div className="quiet">Loading…</div>;

  const view = whyView(data);

  return (
    <>
      <div className="pagehead"><h1>Why videos win or die</h1></div>
      {view === "unreachable" ? (
        <ReadFailed onRetry={load} />
      ) : view === "empty" ? (
        <div className="empty" style={{ padding: 40 }}>
          <b>Waiting on your first analysis</b>
          Once your channel is read, every video shows up here against your own normal —
          and the deep retention reads land video by video.
          <div style={{ marginTop: 14 }}>
            <Link className="btn btn-acc" href="/desk">Go to the Desk</Link>
          </div>
        </div>
      ) : (
        <>
        {!data.flagsActive && (
          <div className="aside-note" style={{ marginBottom: 12 }}>
            <b>Early days — too few views to point at lessons yet</b>
            While your videos are under about 100 views, one extra viewer can flip a row, so we
            don&apos;t call wins or misses. As your views grow, each row will tell you which videos
            to study and which to fix — that&apos;s how the next upload gets more views.
          </div>
        )}
        <div className="card">
          <table className="t">
            <thead>
              <tr>{["Video", "Views", data.flagsActive ? "What it tells you" : "Views vs your usual", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.videos.map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="vcell">
                      <Thumb url={v.thumbnail_url} alt="" />
                      <div>
                        <b style={{ fontSize: 13 }}>{v.title ?? v.yt_video_id}</b>
                        <div className="sub">
                          {v.published_at ? new Date(v.published_at).toLocaleDateString() : ""}
                          {v.is_short ? " · Short" : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{fmtNum(v.view_count)}</td>
                  <td style={{ minWidth: 150 }}>
                    <RatioBar
                      ratio={v.ratio}
                      muted={!data.flagsActive}
                      views={v.view_count}
                      usual={(v.is_short ? data.baselines.shorts : data.baselines.longform)?.median_views ?? null}
                    />
                  </td>
                  <td>
                    <Link href={`/why/${v.id}`} className="btn btn-ghost btn-sm">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Explain
            why="Raw views lie — 5,000 views is a win for one channel and a flop for another."
            how="Each video is compared with what YOUR uploads usually get. Shorts and full videos are never mixed."
            what="Open a 'fell short' video to see where viewers left; study the 'did something right' ones — they're your patterns to repeat."
          />
        </div>
        </>
      )}
    </>
  );
}
