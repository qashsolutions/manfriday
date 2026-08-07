"use client";

/** "How viewers found it — and why that changed": the moment a creator watches
    a video's views fall off and can't tell whether it was their video or the
    algorithm. Presentational only — every state arrives as props, so the
    honest thin state is provable without an account (DESIGN.md §13).

    The one thing this screen must never do is dress a fall in the feed up as a
    failure. A video widening to strangers and a video getting worse look
    identical on a views graph and are opposites, so nothing here is coloured
    good or bad: the words carry the verdict and the numbers carry the proof. */

import { Md } from "@/components/Md";
import { Receipt } from "@/components/Receipt";
import { OptionCard, type OptionType } from "@/components/OptionCard";
import { Working } from "@/components/Working";
import { type EvidenceItem } from "@/components/Verdict";
import { TEAM, TEAM_ATTRIBUTION, sentenceCase } from "@/lib/team";

export type DistributionState = "you" | "distribution" | "steady" | "too_early";

export type FoundRow = { label: string; views: number; share: number };
export type ChangeRow = { key: string; label: string; recent: number; prior: number };
export type DistributionWindows = { recentFrom: string; recentTo: string; priorFrom: string; priorTo: string };

export type DistributionOption = {
  type: OptionType;
  effort: string;
  text: string;
  category: string;
  why: string;
  confidence: number;
  evidence: EvidenceItem[];
};

export type DistributionAnalysis = {
  state: DistributionState;
  verdict: string;
  where_from: string;
  what_changed: string | null;
  control_test: string | null;
  steady_note: string | null;
  options: DistributionOption[];
};

/** Exactly what the route hands back, plus the created_at of a saved read. */
export type DistributionRead = {
  state: DistributionState;
  reason: string | null;
  reasonKind: "too_new" | "too_quiet" | null;
  found: FoundRow[];
  foundTotal: number;
  change: ChangeRow[] | null;
  windows: DistributionWindows | null;
  checkBy: string | null;
  analysis: DistributionAnalysis | null;
  createdAt?: string | null;
};

/** The four answers, in the creator's words. "Too early to judge" is the only
    one rendered muted — honesty about thin data is not a warning state
    (DESIGN.md §7); the other three are open claims, so they wear Ledger Blue
    and let the sentence beside them do the work. */
const VERDICT_CHIP: Record<DistributionState, { label: string; cls: string }> = {
  you: { label: "mostly your video", cls: "acc" },
  distribution: { label: "mostly how YouTube spread it", cls: "acc" },
  steady: { label: "nothing moved", cls: "acc" },
  too_early: { label: "too early to judge", cls: "mut" },
};

/** ISO day → "Aug 21", built from the parts so a timezone behind UTC can't
    quietly show yesterday. */
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Jul 23–29" inside one month, "Jul 30–Aug 5" across two. */
function fmtRange(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${fmtDay(from)}–${sameMonth ? Number(to.slice(8, 10)) : fmtDay(to)}`;
}

function windowLabel(w: DistributionWindows): string {
  return `${fmtRange(w.recentFrom, w.recentTo)} against ${fmtRange(w.priorFrom, w.priorTo)}`;
}

/** Which way a way-in moved, in a word a creator would use. No colour: a fall
    in the feed is not a bad mark against the video, and that is the point. */
function movement(recent: number, prior: number): string {
  if (prior === 0) return recent > 0 ? "new this week" : "none either week";
  const r = recent / prior;
  if (r >= 1.25) return "up";
  if (r <= 0.75) return "down";
  return "held steady";
}

function WhereFrom({ found, total }: { found: FoundRow[]; total: number }) {
  if (!found.length) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
        YouTube hasn&apos;t attributed any of this video&apos;s views to a way in yet — that starts once a
        few more people watch.
      </p>
    );
  }
  const max = Math.max(...found.map((f) => f.views), 1);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {found.map((f, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.45 }}>{f.label}</div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--line2)", marginTop: 4 }}>
              <div style={{ width: `${Math.max(3, (f.views / max) * 100)}%`, height: "100%", borderRadius: 3, background: "var(--acc)" }} />
            </div>
          </div>
          <span className="num" style={{ fontSize: 11.5, color: "var(--ink2)", whiteSpace: "nowrap" }}>
            {f.views.toLocaleString()} of {total.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function WhatChanged({ change, windows }: { change: ChangeRow[]; windows: DistributionWindows | null }) {
  const max = Math.max(...change.flatMap((c) => [c.recent, c.prior]), 1);
  const bar = (v: number, color: string) => (
    <div style={{ height: 6, borderRadius: 3, background: "var(--line2)", flex: 1, minWidth: 40 }}>
      <div style={{ width: `${Math.max(2, (v / max) * 100)}%`, height: "100%", borderRadius: 3, background: color }} />
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {windows && (
        <div className="num" style={{ fontSize: 11.5, color: "var(--ink3)" }}>{windowLabel(windows)}</div>
      )}
      {change.map((c) => (
        <div key={c.key} style={{ display: "grid", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink)" }}>{c.label}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>{movement(c.recent, c.prior)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="sub" style={{ width: 78, flex: "none" }}>week before</span>
            {bar(c.prior, "var(--ink3)")}
            <span className="num" style={{ fontSize: 11.5, width: 44, textAlign: "right", flex: "none" }}>{c.prior.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="sub" style={{ width: 78, flex: "none" }}>last week</span>
            {bar(c.recent, "var(--acc)")}
            <span className="num" style={{ fontSize: 11.5, width: 44, textAlign: "right", flex: "none" }}>{c.recent.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DistributionSection({
  read, asking, stages, prose, error, logged, onAsk, onLog,
}: {
  read: DistributionRead | null;
  asking: boolean;
  stages: string[];
  prose: string;
  error: string | null;
  /** Option texts already in the Ledger, so a pick can't be logged twice. */
  logged: Set<string>;
  onAsk: () => void;
  onLog: (o: DistributionOption, checkBy: string | null) => void;
}) {
  const seat = sentenceCase(TEAM_ATTRIBUTION.name);
  const chip = read ? VERDICT_CHIP[read.state] : null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="k">How viewers found it — and why that changed</span>
        {read?.createdAt && (
          <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
            written {new Date(read.createdAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {asking && !read ? (
        <div style={{ marginTop: 10 }}>
          <Working stages={stages} />
          {prose && (
            <div style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 10 }}>
              <Md md={prose} />
            </div>
          )}
        </div>
      ) : read ? (
        <div style={{ marginTop: 10, display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {chip && <span className={`pill ${chip.cls}`}>{chip.label}</span>}
          </div>

          {read.analysis ? <Md md={read.analysis.verdict} /> : null}
          {read.reason && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
              {read.reason}
            </p>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            <span className="k">Where the views came from</span>
            <WhereFrom found={read.found} total={read.foundTotal} />
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
              {read.analysis?.where_from ??
                "The more of these YouTube sends itself — search, suggestions, its home page — the further a video travels past the people you told about it yourself."}
            </p>
          </div>

          {read.change?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <span className="k">What changed</span>
              <WhatChanged change={read.change} windows={read.windows} />
              {read.analysis?.what_changed && (
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.6, maxWidth: "62ch" }}>
                  {read.analysis.what_changed}
                </p>
              )}
            </div>
          ) : null}

          {read.analysis?.control_test && read.windows && (
            <Receipt provenance={`your channel · ${windowLabel(read.windows)}`}>
              {read.analysis.control_test}
            </Receipt>
          )}

          {read.analysis?.steady_note && (
            <div className="aside-note">
              <b>Before you panic</b>
              {read.analysis.steady_note}
            </div>
          )}

          {read.analysis?.options?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <span className="k">What you can do about it — you pick what lands in your Ledger</span>
              <div style={{ display: "grid", gap: 10, maxWidth: 620 }}>
                {read.analysis.options.map((o, i) => (
                  <OptionCard
                    key={i}
                    type={o.type}
                    effort={o.effort}
                    choice={o.text}
                    why={o.why}
                    confidence={o.confidence}
                    evidence={o.evidence}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      {logged.has(o.text) ? (
                        <span className="pill good">✓ in your Ledger — {TEAM.scorekeeper.name} will check it</span>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => onLog(o, read.checkBy)}>
                          I&apos;ll do this — log it
                        </button>
                      )}
                      {read.checkBy && (
                        <span className="sub">
                          check back on {fmtDay(read.checkBy)} — that&apos;s when YouTube&apos;s numbers on a
                          change like this have settled
                        </span>
                      )}
                    </div>
                  </OptionCard>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <button className="btn btn-ghost btn-sm" onClick={onAsk} disabled={asking}>
              {asking ? `${seat} is reading it again…` : "Ask again"}
            </button>
            {error && <span className="err" style={{ marginLeft: 10, fontSize: 12.5 }}>{error}</span>}
          </div>
        </div>
      ) : (
        <div className="grid g2" style={{ marginTop: 8, alignItems: "center" }}>
          <p style={{ margin: 0, color: "var(--ink2)", fontSize: 13, lineHeight: 1.6 }}>
            When views fall away, the question is whether the video stopped working or YouTube stopped
            showing it around — and they look identical on a graph. The team reads the ways in week by
            week: the people who already follow you are the one route YouTube&apos;s recommendations
            don&apos;t touch, so if they kept watching while the feed dried up, it wasn&apos;t your video.
          </p>
          <div>
            {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}
            <button className="btn btn-acc" onClick={onAsk} disabled={asking}>
              {asking ? `${seat} is reading it…` : "Was it my video or the algorithm? — ask the team"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
