"use client";

/** The Desk's three answers, as three modules. Each one states what happened
    in the creator's own words, welds every number to the move it points at,
    and ends in exactly one action. Presentational only — every state arrives
    as props, so the empty and thin-data states are testable without an
    account (DESIGN.md §13). */

import Link from "next/link";
import { Thumb } from "@/components/Explain";
import { Receipt } from "@/components/Receipt";
import { OptionCard } from "@/components/OptionCard";
import { TEAM, TEAM_ATTRIBUTION, sentenceCase } from "@/lib/team";
import type { Happened, NextAction, NextUp, Score } from "./deskModel";

const TONE_INK: Record<"good" | "crit" | "flat", string> = {
  good: "var(--good)",
  crit: "var(--crit)",
  flat: "var(--ink)",
};

const actionLink: React.CSSProperties = {
  color: "var(--acc)", fontSize: 13, fontWeight: 600, textDecoration: "none",
};

/** One answer: the question it answers, the answer, and the way out of it. */
function Module({ q, action, children }: { q: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 style={{ fontSize: 15, margin: "0 0 10px", letterSpacing: "-.01em" }}>{q}</h2>
      {children}
      {action && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line2)" }}>{action}</div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 1 — What just happened
 * ------------------------------------------------------------------ */

export function WhatJustHappened({ h }: { h: Happened }) {
  if (h.kind === "no-video") {
    return (
      <Module
        q="What just happened?"
        action={<Link href="/why" style={actionLink}>See every video the team can read →</Link>}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
          Nothing published on this channel yet. The day your first video goes up, this is where the
          team tells you how it did against your normal — and what to change so the next one does
          better.
        </p>
      </Module>
    );
  }

  const { video } = h;
  return (
    <Module
      q="What just happened?"
      action={<Link href={h.href} style={actionLink}>{h.actionLabel} →</Link>}
    >
      <div className="vcell" style={{ marginBottom: 12 }}>
        <Thumb url={video.thumbnail_url} alt="" />
        <div>
          <b style={{ fontSize: 13 }}>{video.title ?? video.yt_video_id}</b>
          <div className="sub">
            your latest{video.is_short ? " Short" : ""}
            {video.published_at ? ` · ${new Date(video.published_at).toLocaleDateString()}` : ""}
          </div>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: TONE_INK[h.tone], letterSpacing: "-.01em" }}>
        {h.headline}
      </p>
      <p style={{ margin: "4px 0 12px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
        {h.line}
      </p>

      {h.revelation ? (
        // Ledger Blue: a read is an open claim, not a Scorekeeper verdict (§6).
        <Receipt provenance={h.revelation.provenance}>{h.revelation.text}</Receipt>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink3)" }}>{h.noRead}</p>
      )}
    </Module>
  );
}

/* ------------------------------------------------------------------ *
 * 2 — What to do next
 * ------------------------------------------------------------------ */

export function WhatToDoNext({
  next, onCopy, onApply, applyingId, copiedId, error, note,
}: {
  next: NextUp;
  onCopy: (a: NextAction) => void;
  onApply: (a: NextAction) => void;
  applyingId: string | null;
  copiedId: string | null;
  error: string | null;
  note: string | null;
}) {
  if (next.actions.length === 0) {
    return (
      <Module q="What do I do next?">
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
          Nothing is waiting on you. Two ways to get your next move — both start from your own
          channel, not a checklist:
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          <Link href="/ideas" style={actionLink}>
            The videos your viewers already asked for — {TEAM.listener.name} reads your comments →
          </Link>
          <Link href="/packaging" style={actionLink}>
            Know which title gets clicked before you publish — {TEAM.marketer.name} grades it →
          </Link>
        </div>
      </Module>
    );
  }

  return (
    <Module
      q="What do I do next?"
      // Never a single order: the way out is always to more choices.
      action={
        next.more > 0 ? (
          <Link href="/ledger" style={actionLink}>
            Not one of these? {next.more} more {next.more === 1 ? "tip is" : "tips are"} waiting in
            your Ledger →
          </Link>
        ) : (
          <Link href="/ideas" style={actionLink}>
            Want more to pick from? The videos your viewers already asked for →
          </Link>
        )
      }
    >
      {note && <div className="ok-note">{note}</div>}
      {error && <div className="err">{error}</div>}
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
        {next.actions.length === 1
          ? "One move is on the table — you decide whether it's worth doing."
          : `${next.actions.length} moves are on the table — pick the one you'll actually do.`}
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {next.actions.map((a) => (
          <OptionCard
            key={a.rec.id}
            type={a.type}
            effort={a.effort}
            choice={a.rec.recommendation}
            // The evidence sits where the reasoning would — verbatim when the
            // row carries a viewer's own words, plain reasoning otherwise.
            why={a.receipt ? <Receipt provenance={a.receipt.provenance}>{a.receipt.text}</Receipt> : a.why}
            confidence={a.rec.confidence}
            evidence={a.rec.evidence}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => onCopy(a)}>
                {copiedId === a.rec.id ? "Copied" : "Copy"}
              </button>
              {a.studioUrl && (
                <a className="btn btn-ghost btn-sm" href={a.studioUrl} target="_blank" rel="noreferrer">
                  Open YouTube Studio ↗
                </a>
              )}
              <button
                className="btn btn-acc btn-sm"
                onClick={() => onApply(a)}
                disabled={applyingId === a.rec.id}
              >
                {applyingId === a.rec.id ? "Saving…" : "I did this"}
              </button>
              <Link href={a.href} style={{ ...actionLink, fontSize: 12.5, marginLeft: "auto" }}>
                {a.hrefLabel} →
              </Link>
            </div>
          </OptionCard>
        ))}
      </div>
    </Module>
  );
}

/* ------------------------------------------------------------------ *
 * 3 — Is the advice working
 * ------------------------------------------------------------------ */

export function IsTheAdviceWorking({ score }: { score: Score }) {
  return (
    <Module
      q="Is the advice working?"
      action={<Link href="/ledger" style={actionLink}>See every tip and how it landed →</Link>}
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
        {score.lead}
      </p>
      {score.rows.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {score.rows.map((r) => (
            <div key={r.id}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className={`pill ${r.chip.cls}`}>{r.chip.label}</span>
                {/* A result the creator reported never travels without saying so. */}
                {r.chip.reported && <span className="pill mut">you reported this</span>}
                <b style={{ fontSize: 13, flex: 1, minWidth: 200, fontWeight: 600 }}>{r.text}</b>
                {r.shift && (
                  <span className="num" style={{ fontSize: 12, color: "var(--ink2)", whiteSpace: "nowrap" }}>
                    {r.shift.before.toLocaleString()} → {r.shift.after.toLocaleString()} {r.shift.unit}
                  </span>
                )}
              </div>
              {r.measuredOn && <div className="sub" style={{ marginTop: 2 }}>measured on &quot;{r.measuredOn}&quot;</div>}
            </div>
          ))}
        </div>
      )}
    </Module>
  );
}

/* ------------------------------------------------------------------ *
 * Before there is anything to answer — the guided start
 * ------------------------------------------------------------------ */

const LADDER = [
  {
    title: "Connect your channel",
    body: "Read-only: the team can look, it can't touch. Disconnect any time with one click.",
  },
  {
    title: "See your normal",
    body: "The team reads your last 30 uploads and works out what your videos usually get. That number is the bar every new video is measured against — beat it and you've genuinely done better.",
  },
  {
    title: "Pick your first fix",
    body: "You choose from typed options — never one order. A week later the Scorekeeper says whether it moved your views, misses included.",
  },
];

export function DeskInvitation({
  step, channelTitle, onStart, running, error,
}: {
  /** 1 = no channel yet · 2 = connected, no numbers read yet. */
  step: 1 | 2;
  channelTitle?: string | null;
  onStart?: () => void;
  running?: boolean;
  error?: string | null;
}) {
  return (
    <section className="empty" style={{ padding: 32, textAlign: "left" }}>
      <div className="tick" style={{ marginBottom: 16 }} />
      <b style={{ fontSize: 15 }}>
        {step === 1
          ? "Your team of six is ready. They just need a channel."
          : `${channelTitle ?? "Your channel"} is connected — now the team needs your normal.`}
      </b>
      <p style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
        Three steps to your first real answer — about two minutes of waiting, and none of it is
        homework.
      </p>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12, maxWidth: "62ch" }}>
        {LADDER.map((s, i) => {
          const n = i + 1;
          const done = n < step;
          const now = n === step;
          return (
            <li key={s.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span
                className="num"
                style={{
                  flex: "none", width: 22, height: 22, borderRadius: 999, fontSize: 11.5,
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
                  background: done ? "var(--good-soft)" : now ? "var(--acc-soft)" : "var(--line2)",
                  color: done ? "var(--good)" : now ? "var(--acc)" : "var(--ink3)",
                }}
              >
                {n}
              </span>
              <div>
                <b style={{ fontSize: 13, color: now ? "var(--ink)" : "var(--ink2)" }}>{s.title}</b>
                {done && <span className="pill good" style={{ marginLeft: 8 }}>done</span>}
                <div style={{ fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.55, marginTop: 2 }}>
                  {s.body}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {error && <div className="err" style={{ marginTop: 16 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {step === 1 ? (
          <Link href="/settings#connections" className="btn btn-acc btn-lg">Connect my channel</Link>
        ) : (
          <button className="btn btn-acc btn-lg" onClick={onStart} disabled={running}>
            {running
              ? `${sentenceCase(TEAM_ATTRIBUTION.name)} is reading your last 30 uploads…`
              : "Show me my normal"}
          </button>
        )}
      </div>
    </section>
  );
}
