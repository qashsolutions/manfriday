"use client";

/** The Desk = the three questions a creator opens the app with, answered in
    order: what just happened, what to do next, is the advice working. Every
    module ends in one action. Nothing here computes a new read — it composes
    what the team has already stored (DESIGN.md §13 states included). */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadChannelData, type ChannelData } from "@/lib/channelData";
import { Working } from "@/components/Working";
import { ReadFailed } from "@/components/ReadFailed";
import { TEAM, TEAM_ATTRIBUTION, agentNames, sentenceCase } from "@/lib/team";
import {
  deskView, isTheAdviceWorking, whatJustHappened, whatToDoNext,
  type DeskReport, type NextAction, type Rec,
} from "./deskModel";
import { DeskInvitation, IsTheAdviceWorking, WhatJustHappened, WhatToDoNext } from "./DeskModules";

const NO_DATA: ChannelData = { channel: null, baselines: {}, videos: [], flagsActive: false, lastUpdated: null, failed: false };

export default function DeskPage() {
  const supabase = supabaseBrowser();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<ChannelData>(NO_DATA);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [reports, setReports] = useState<DeskReport[]>([]);
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [applyNote, setApplyNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Unreachable Supabase returns an error with a null user; signed out
    // returns a null user and no error. Only one of those is the error state.
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;
    if (!user) return;
    const [prof, cd, recRows, reportRows] = await Promise.all([
      supabase.from("profiles").select("paused_at").eq("id", user.id).maybeSingle(),
      loadChannelData(),
      supabase
        .from("recommendations")
        .select("id,created_at,agent,category,recommendation,notes,status,verdict,target_type,target_yt_id,confidence,evidence,option_type,result_snapshot,updates")
        .order("created_at", { ascending: false })
        .limit(100),
      // Both seats that write a per-video read: the team's why-verdict and the
      // Editor's drop read. Historical names included — stored rows keep theirs.
      supabase
        .from("reports")
        .select("video_id,agent,data,created_at")
        .in("agent", [...agentNames(TEAM.editor), ...agentNames(TEAM_ATTRIBUTION)])
        .not("video_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    // A failed read used to render as a brand-new account. It says so now —
    // whichever of the three reads is the one that couldn't get through.
    if (cd.failed) throw new Error("Your channel numbers couldn't be read.");
    if (recRows.error || reportRows.error) throw new Error(recRows.error?.message ?? reportRows.error?.message);
    setPaused(Boolean(prof.data?.paused_at));
    setData(cd);
    setRecs((recRows.data as Rec[] | null) ?? []);
    setReports((reportRows.data as DeskReport[] | null) ?? []);
  }, [supabase]);

  const refresh = useCallback(async () => {
    setPhase((p) => (p === "ready" ? p : "loading"));
    try {
      await load();
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [load]);

  useEffect(() => { refresh(); }, [refresh]);

  async function runFirstAnalysis() {
    setRunErr(null);
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/analysis/first-run", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The read couldn't finish.");
      await refresh();
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : "The read couldn't finish.");
    } finally {
      setRunning(false);
    }
  }

  /** The apply loop, step one: the words go on the clipboard so the change can
      be made where it lives — in YouTube Studio. */
  async function copyAction(a: NextAction) {
    setApplyErr(null);
    try {
      await navigator.clipboard.writeText(a.copyText);
      setCopiedId(a.rec.id);
      setTimeout(() => setCopiedId((id) => (id === a.rec.id ? null : id)), 2500);
    } catch {
      setApplyErr("Your browser wouldn't let us reach the clipboard — select the text and copy it by hand.");
    }
  }

  /** Step two: marking it applied starts the Scorekeeper's clock against the
      numbers snapshotted when the tip was logged. */
  async function applyAction(a: NextAction) {
    setApplyErr(null);
    setApplyNote(null);
    setApplyingId(a.rec.id);
    const updates = [...(a.rec.updates ?? []), { type: "applied", at: new Date().toISOString() }];
    const { error } = await supabase
      .from("recommendations")
      .update({ status: "applied", updates })
      .eq("id", a.rec.id);
    setApplyingId(null);
    if (error) {
      setApplyErr("That didn't save — try again in a moment.");
      return;
    }
    setApplyNote(
      `Marked as done. ${sentenceCase(TEAM.scorekeeper.name)} checks it against your views in a week and says whether it paid.`
    );
    await refresh();
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const { channel } = data;
  const view = deskView(data);

  const head = (
    <div className="pagehead">
      <h1>The Desk</h1>
      <span className="when">{today}</span>
      {phase === "ready" && view === "ready" && data.lastUpdated && (
        <span className="sub" style={{ marginLeft: "auto" }}>
          your YouTube numbers as of{" "}
          {new Date(data.lastUpdated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
      )}
    </div>
  );

  if (phase === "loading") {
    return (
      <>
        {head}
        <div className="card">
          <Working stages={[`${sentenceCase(TEAM_ATTRIBUTION.name)} is pulling today's numbers together…`]} />
        </div>
      </>
    );
  }

  // Either route into failure — a thrown read, or data that came back marked
  // unreadable — lands on the same honest screen. Never the connect invitation.
  if (phase === "error" || view === "unreachable") {
    return (
      <>
        {head}
        <ReadFailed onRetry={refresh} />
      </>
    );
  }

  const happened = whatJustHappened(data, reports);
  const next = whatToDoNext(recs, data.videos);
  const score = isTheAdviceWorking(recs);

  return (
    <>
      {head}

      {paused && (
        <div className="banner">
          Your account is paused — the team isn&apos;t reading anything, so these answers stop
          updating. Resume any time in <Link href="/settings">Settings</Link>.
        </div>
      )}

      {view === "connect" ? (
        <DeskInvitation step={1} />
      ) : view === "first-read" ? (
        <DeskInvitation
          step={2}
          channelTitle={channel?.title}
          onStart={runFirstAnalysis}
          running={running}
          error={runErr}
        />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <WhatJustHappened h={happened} />
          <WhatToDoNext
            next={next}
            onCopy={copyAction}
            onApply={applyAction}
            applyingId={applyingId}
            copiedId={copiedId}
            error={applyErr}
            note={applyNote}
          />
          <IsTheAdviceWorking score={score} />
        </div>
      )}
    </>
  );
}
