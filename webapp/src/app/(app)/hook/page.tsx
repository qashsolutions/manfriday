"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, type ChannelData, type VideoPerf } from "@/lib/channelData";
import { ReadFailed, readFailed } from "@/components/ReadFailed";
import { proseBuffer, readAnalystStream } from "@/components/Working";
import { TEAM, agentNames, sentenceCase } from "@/lib/team";
import { type HookRead, type HookRewrite } from "@/lib/hook";
import { HookCompose, HookRewrites, type HookMode } from "./HookDesk";
import { fmtDay } from "../why/[id]/DistributionSection";

/** Fix your opening — the Editor on the first thirty seconds alone.

    The compose surface and the openings that come back both live in HookDesk,
    so every state this screen can be in is provable without an account. This
    file owns the state, the request, and the one write to the Ledger. */

type Done = HookRead & { report: { id: string; created_at: string } | null };

export default function HookPage() {
  const supabase = supabaseBrowser();
  const [data, setData] = useState<ChannelData | null>(null);
  const [mode, setMode] = useState<HookMode>("draft");
  const [draft, setDraft] = useState("");
  const [spoken, setSpoken] = useState("");
  const [video, setVideo] = useState("");
  const [asking, setAsking] = useState(false);
  const [stages, setStages] = useState<string[]>([]);
  const [prose, setProse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<HookRead | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  // Which of their openings held best. Only a read can find it, and once found
  // it stays — it's what the voice-sample field is allowed to name.
  const [bestHeld, setBestHeld] = useState<string | null>(null);

  const load = useCallback(() => {
    setData(null);
    loadChannelData().then(setData);
  }, []);
  useEffect(() => { load(); }, [load]);

  // The optional paste swaps jobs with the mode, so the words from one mode
  // must never be sent as if they were the other's.
  function switchMode(m: HookMode) {
    if (m === mode) return;
    setMode(m);
    setSpoken("");
    setError(null);
  }

  async function ask() {
    setError(null);
    setAsking(true);
    setRead(null);
    setProse("");
    setStages([`${sentenceCase(TEAM.editor.name)} is picking up your opening…`]);
    const buffer = proseBuffer((add) => setProse((p) => p + add));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analyst/hook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify(
          mode === "video"
            ? { video, spoken: spoken.trim() || undefined }
            : {
                draft,
                spoken: spoken.trim() || undefined,
                spokenFrom: spoken.trim() ? bestHeld ?? undefined : undefined,
              }
        ),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "The read couldn't finish.");
      }
      if (!r.body) throw new Error("The read couldn't finish.");

      let j: Done | null = null;
      for await (const ev of readAnalystStream<Done>(r.body)) {
        if (ev.t === "stage") setStages((s) => [...s, ev.m]);
        else if (ev.t === "prose") buffer.push(ev.d);
        else if (ev.t === "error") throw new Error(ev.error);
        else if (ev.t === "done") j = ev;
      }
      buffer.flush();
      if (!j) throw new Error("The read stopped before it finished — try again.");

      setRead({
        grounded: j.grounded,
        exits: j.exits,
        held: j.held,
        videosRead: j.videosRead,
        viewsFloor: j.viewsFloor,
        target: j.target,
        draft: j.draft,
        checkBy: j.checkBy,
        analysis: j.analysis,
        createdAt: j.report?.created_at ?? null,
      });
      if (j.held?.[0]) setBestHeld(j.held[0].videoTitle);

      // Openings already in the Ledger — so "log it" can't double up.
      const choices = (j.analysis?.rewrites ?? []).map((x) => x.choice);
      if (choices.length) {
        const { data: existing } = await supabase
          .from("recommendations").select("recommendation")
          .in("agent", agentNames(TEAM.editor)).in("recommendation", choices);
        const found = new Set(((existing ?? []) as { recommendation: string }[]).map((x) => x.recommendation));
        if (found.size) setLogged(found);
      }
    } catch (e) {
      setProse("");
      setError(e instanceof Error ? e.message : "The read couldn't finish.");
    } finally {
      setAsking(false);
    }
  }

  async function copyOpening(r: HookRewrite) {
    try {
      await navigator.clipboard.writeText(r.opening);
      setCopied(r.shape);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't reach your clipboard — select the words and copy them by hand.");
    }
  }

  /** "I'll say this" → the pick lands in the Ledger with the day the
      Scorekeeper's verdict is due, and a before-number when there is a video
      to measure it against. */
  async function logPick(r: HookRewrite, checkBy: string | null) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const target: VideoPerf | undefined = read?.target
      ? data?.videos.find((v) => v.yt_video_id === read.target?.ytVideoId)
      : undefined;
    const { error: err } = await supabase.from("recommendations").insert({
      user_id: user.id,
      agent: TEAM.editor.name,
      category: "retention",
      recommendation: r.choice,
      target_type: target ? "video" : "channel",
      ...(target ? { target_yt_id: target.yt_video_id } : {}),
      ...(target
        ? {
            baseline: {
              view_count: target.view_count,
              views_per_day: target.views_per_day,
              captured_at: new Date().toISOString(),
            },
          }
        : {}),
      notes: [
        r.why,
        `Say: "${r.opening}"`,
        checkBy
          ? `verdict by ${fmtDay(checkBy)} — that's when enough new viewers have seen it for the change to show`
          : null,
      ].filter(Boolean).join(" · "),
      confidence: Math.max(0, Math.min(100, Math.round(r.confidence))),
      evidence: r.evidence ?? [],
      option_type: null,
    });
    if (!err) setLogged((s) => new Set(s).add(r.choice));
  }

  if (!data) return <div className="quiet">Loading…</div>;
  if (readFailed(data)) return <ReadFailed onRetry={load} />;

  if (!data.channel) {
    return (
      <>
        <div className="pagehead"><h1>Fix your opening</h1></div>
        <div className="empty" style={{ padding: 40 }}>
          <b>The team needs your channel first</b>
          {sentenceCase(TEAM.editor.name)} writes openings around the exact second your own viewers
          stopped watching — so the first step is letting the team read your videos.
          <div style={{ marginTop: 14 }}>
            <Link className="btn btn-acc" href="/desk">Run the first analysis</Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pagehead"><h1>Fix your opening</h1></div>
      <HookCompose
        mode={mode}
        onMode={switchMode}
        draft={draft}
        onDraft={setDraft}
        spoken={spoken}
        onSpoken={setSpoken}
        videos={data.videos.map((v) => ({ yt_video_id: v.yt_video_id, title: v.title }))}
        video={video}
        onVideo={setVideo}
        bestHeldTitle={bestHeld}
        asking={asking}
        error={error && !read ? error : null}
        onAsk={ask}
      />
      <HookRewrites
        read={read}
        asking={asking}
        stages={stages}
        prose={prose}
        error={read ? error : null}
        logged={logged}
        copied={copied}
        onCopy={copyOpening}
        onLog={logPick}
        onAskAgain={ask}
      />
    </>
  );
}
