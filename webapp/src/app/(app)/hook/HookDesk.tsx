"use client";

/** The Hook Doctor's two halves, both presentational: the desk the creator
    writes at, and the openings that come back.

    Everything arrives as props on purpose. A live account can only ever show
    the state its own channel happens to be in — on a young channel that is
    always the craft-based one — so the grounded state, the honest thin state
    and the openings-only answer are provable here and nowhere else
    (DESIGN.md §13). */

import { Md } from "@/components/Md";
import { Receipt } from "@/components/Receipt";
import { OptionCard } from "@/components/OptionCard";
import { Explain } from "@/components/Explain";
import { Working } from "@/components/Working";
import { TEAM, sentenceCase } from "@/lib/team";
import {
  CRAFT_LABEL, GHOSTWRITE_LINE, OPENING_SECONDS, OPENING_WORD_LIMIT,
  overOpeningLimit, wordCount,
  type HookRead, type HookRewrite,
} from "@/lib/hook";
import { fmtDay } from "../why/[id]/DistributionSection";

export type HookMode = "draft" | "video";
export type HookVideoOption = { yt_video_id: string; title: string | null };

/* ── The desk ─────────────────────────────────────────────────────────── */

export function HookCompose({
  mode, onMode, draft, onDraft, spoken, onSpoken,
  videos, video, onVideo, bestHeldTitle, asking, error, onAsk,
}: {
  mode: HookMode;
  onMode: (m: HookMode) => void;
  draft: string;
  onDraft: (v: string) => void;
  /** The one optional paste. Its job switches with the mode: in video mode it
      is what that video actually says at the start, in draft mode it is how a
      past opening of theirs went. */
  spoken: string;
  onSpoken: (v: string) => void;
  videos: HookVideoOption[];
  video: string;
  onVideo: (id: string) => void;
  /** Named only once a read has found it — until then there is no honest way
      to say which of their openings held best. */
  bestHeldTitle: string | null;
  asking: boolean;
  error: string | null;
  onAsk: () => void;
}) {
  const words = wordCount(draft);
  // Only the draft can be too long: in re-hook mode the draft box isn't the
  // input, so text left behind in it must not raise the openings-only answer.
  const tooLong = mode === "draft" && overOpeningLimit(draft);
  const seat = sentenceCase(TEAM.editor.name);
  const ready = mode === "draft" ? Boolean(draft.trim()) && !tooLong : Boolean(video);

  return (
    <div className="card">
      <span className="k">Your first 30 seconds</span>
      <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
        Most of the viewers a video loses are gone before the half-minute mark. {seat} finds the exact
        second yours left the last few times, then writes you openings that get past it — the cheapest
        change you can make, and the one that keeps the most people watching, which is what decides how
        widely YouTube shows the video.
      </p>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === "draft" ? "on" : ""} onClick={() => onMode("draft")}>
          Paste a draft
        </button>
        <button className={mode === "video" ? "on" : ""} onClick={() => onMode("video")}>
          Re-hook a video
        </button>
      </div>

      {mode === "draft" ? (
        <>
          <label className="field">
            <span>The opening you&apos;ve written — the first {OPENING_SECONDS} seconds you&apos;ll say</span>
            <textarea
              className="input"
              rows={4}
              style={{ resize: "vertical", fontFamily: "inherit" }}
              placeholder="Paste the words you plan to open with…"
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
            />
          </label>
          <div className="sub" style={{ marginTop: -6, marginBottom: 12 }}>
            <span className="num">{words}</span> of about {OPENING_WORD_LIMIT} words — roughly the{" "}
            {OPENING_SECONDS} seconds where viewers decide whether to stay
          </div>
          <label className="field">
            <span>
              Sound like you (optional) —{" "}
              {bestHeldTitle
                ? `paste how you opened "${bestHeldTitle}", the one that kept the most viewers`
                : "paste how one of your videos opens"}
            </span>
            <textarea
              className="input"
              rows={3}
              style={{ resize: "vertical", fontFamily: "inherit" }}
              placeholder="Paste the first lines you actually said…"
              value={spoken}
              onChange={(e) => onSpoken(e.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>Which video needs a stronger start</span>
            <select className="input" value={video} onChange={(e) => onVideo(e.target.value)}>
              <option value="">Pick one of your videos…</option>
              {videos.map((v) => (
                <option key={v.yt_video_id} value={v.yt_video_id}>{v.title ?? v.yt_video_id}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>How does this video open? (paste the first lines — YouTube&apos;s transcript panel has them)</span>
            <textarea
              className="input"
              rows={3}
              style={{ resize: "vertical", fontFamily: "inherit" }}
              placeholder="Paste what you say in the first few seconds…"
              value={spoken}
              onChange={(e) => onSpoken(e.target.value)}
            />
          </label>
          <div className="sub" style={{ marginTop: -6, marginBottom: 12 }}>
            Worth the minute: with your real words, {seat} can tell you what viewers heard just before
            they left — and write the new opening in your voice rather than a generic one.
          </div>
        </>
      )}

      {tooLong && <div className="err">{GHOSTWRITE_LINE}</div>}
      {error && <div className="err">{error}</div>}

      <button className="btn btn-acc" onClick={onAsk} disabled={asking || !ready}>
        {asking ? `${seat} is writing your openings…` : "Write me openings"}
      </button>

      <Explain
        why="Viewers who stay past the first 30 seconds are what tells YouTube to show a video to more people."
        how={`${seat} reads the exact second viewers left your recent videos, then writes openings that get past those moments.`}
        what="Pick the opening you'll actually say and log it — the Scorekeeper checks what it did to your views."
      />
    </div>
  );
}

/* ── The openings ─────────────────────────────────────────────────────── */

function WhereTheyLeft({ read }: { read: HookRead }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span className="k">
        Where viewers left your first minute — the seconds a new opening has to get past
      </span>
      <div style={{ display: "grid", gap: 6 }}>
        {read.exits.map((e, i) => (
          <div
            key={i}
            style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: 12.5 }}
          >
            <span className="pill acc num" style={{ flex: "none" }}>{e.label}</span>
            <span style={{ color: "var(--ink)" }}>{e.videoTitle}</span>
            <span style={{ color: "var(--ink2)" }}>
              {e.lostPer100} of every 100 who got that far left here — {e.stillPer100} of every 100 were
              still watching after it
            </span>
          </div>
        ))}
      </div>
      {read.analysis?.where_they_left && (
        <Receipt provenance={`your channel · ${read.videosRead} ${read.videosRead === 1 ? "video" : "videos"} read`}>
          {read.analysis.where_they_left}
        </Receipt>
      )}
    </div>
  );
}

function HeldBest({ read }: { read: HookRead }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="k">Your opening that held best — the one worth copying</span>
      {read.held.map((h, i) => (
        <div key={i} style={{ fontSize: 12.5, color: "var(--ink2)" }}>
          <b style={{ color: "var(--ink)" }}>{h.videoTitle}</b> — {h.heldPer100} of every 100 were still
          watching at {h.label}, so whatever you did at the start of that one is worth doing again
        </div>
      ))}
    </div>
  );
}

/** How many openings came back, counted in words rather than a digit — and
    honest at any count, so a short answer can never be announced as three. */
function countWord(n: number): string {
  return n === 1 ? "One opening" : n === 2 ? "Two openings" : n === 3 ? "Three openings" : `${n} openings`;
}

export function HookRewrites({
  read, asking, stages, prose, error, logged, copied, onCopy, onLog, onAskAgain,
}: {
  read: HookRead | null;
  asking: boolean;
  stages: string[];
  prose: string;
  error: string | null;
  /** Choices already in the Ledger — by their choice line, which is what the
      row stores — so a pick can't be logged twice. */
  logged: Set<string>;
  /** Which opening was last copied, by its shape. */
  copied: string | null;
  onCopy: (r: HookRewrite) => void;
  onLog: (r: HookRewrite, checkBy: string | null) => void;
  onAskAgain: () => void;
}) {
  const seat = sentenceCase(TEAM.editor.name);

  if (asking && !read) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <Working stages={stages} />
        {prose && (
          <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}>
            <Md md={prose} />
          </div>
        )}
      </div>
    );
  }

  if (!read) return null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="k" title={TEAM.editor.job}>
          {read.target ? `A stronger opening for "${read.target.title}"` : "A stronger opening for your draft"}
        </span>
        {read.createdAt && (
          <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
            written {new Date(read.createdAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Honesty about thin numbers is not a warning state (DESIGN.md §7). */}
          {read.grounded ? (
            <span className="pill acc">
              built on the seconds your viewers left {read.videosRead}{" "}
              {read.videosRead === 1 ? "video" : "videos"}
            </span>
          ) : (
            <span className="pill mut">{CRAFT_LABEL}</span>
          )}
        </div>

        {read.analysis && <Md md={read.analysis.in_short} />}

        {!read.grounded && (
          <div className="aside-note">
            <b>What changes once more people watch</b>
            None of your videos has passed about {read.viewsFloor} viewers yet, and below that a drop is a
            handful of people rather than a pattern — so these openings are built on craft, not on your
            numbers. The first time one of your videos gets past it, this page rewrites your opening
            around the exact second viewers leave.
          </div>
        )}

        {read.grounded && read.exits.length > 0 && <WhereTheyLeft read={read} />}
        {read.grounded && read.held.length > 0 && <HeldBest read={read} />}

        {read.analysis?.voice_note && (
          <div className="aside-note">
            <b>About the voice</b>
            {read.analysis.voice_note}
          </div>
        )}

        {read.analysis?.rewrites?.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            <span className="k">
              {countWord(read.analysis.rewrites.length)} — you pick the one you&apos;ll actually say
            </span>
            <div style={{ display: "grid", gap: 10, maxWidth: 620 }}>
              {read.analysis.rewrites.map((r, i) => (
                <OptionCard key={i} effort={r.effort} choice={r.choice} why={r.why}
                  confidence={r.confidence} evidence={r.evidence}>
                  <div style={{
                    border: "1px solid var(--line)", borderRadius: 8, padding: 12,
                    fontSize: 13.5, lineHeight: 1.6, color: "var(--ink)", background: "var(--bg)",
                  }}>
                    {r.opening}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => onCopy(r)}>
                      {copied === r.shape ? "Copied" : "Copy"}
                    </button>
                    {logged.has(r.choice) ? (
                      <span className="pill good">✓ in your Ledger — {TEAM.scorekeeper.name} will check it</span>
                    ) : (
                      <button className="btn btn-acc btn-sm" onClick={() => onLog(r, read.checkBy)}>
                        I&apos;ll say this — log it
                      </button>
                    )}
                    {read.checkBy && (
                      <span className="sub">
                        verdict by {fmtDay(read.checkBy)} — that&apos;s when enough new viewers have seen
                        it for the change to show
                      </span>
                    )}
                  </div>
                </OptionCard>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <button className="btn btn-ghost btn-sm" onClick={onAskAgain} disabled={asking}>
            {asking ? `${seat} is writing again…` : "Write me another set"}
          </button>
          {error && <span className="err" style={{ marginLeft: 10, fontSize: 12.5 }}>{error}</span>}
        </div>
      </div>
    </div>
  );
}
