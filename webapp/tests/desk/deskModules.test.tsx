/** The Desk's designed states, rendered. The empty and thin-data states are
    the point: a live signed-in account has a connected channel and real
    numbers, so those two screens can only be proved here (DESIGN.md §13). */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DeskInvitation, IsTheAdviceWorking, WhatJustHappened, WhatToDoNext,
} from "@/app/(app)/desk/DeskModules";
import type { Happened, NextUp, Score } from "@/app/(app)/desk/deskModel";

const noop = () => {};

/** Markup with the tags stripped — what a reader actually sees. */
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

const BANNED = /\b(median|baseline|ratio|quartile|delta|metric|KPI|dashboard|optimi[sz]e|insight|leverage|AI-powered)\b/i;

describe("the empty Desk — a brand-new account", () => {
  it("invites the connect, and shows what the two steps after it are worth", () => {
    const t = text(<DeskInvitation step={1} />);
    expect(t).toContain("Your team of six is ready. They just need a channel.");
    expect(t).toContain("Connect your channel");
    expect(t).toContain("See your normal");
    expect(t).toContain("Pick your first fix");
    // the reason to connect is stated in views terms, not features
    expect(t).toContain("That number is the bar every new video is measured against");
    expect(t).toContain("Connect my channel");
    expect(t).not.toMatch(BANNED);
  });

  it("points the connect button at the place that does it", () => {
    expect(html(<DeskInvitation step={1} />)).toContain('href="/settings#connections"');
  });

  it("ticks the connect step off once the channel is on, and asks for the read", () => {
    const t = text(<DeskInvitation step={2} channelTitle="Bench Notes" onStart={noop} />);
    expect(t).toContain("Bench Notes is connected — now the team needs your normal.");
    expect(t).toContain("Show me my normal");
    expect(t).toContain("about two minutes");
  });

  it("says what went wrong when the first read fails, and leaves the button", () => {
    const t = text(<DeskInvitation step={2} onStart={noop} error="Couldn't reach YouTube — try again in a minute." />);
    expect(t).toContain("Couldn't reach YouTube — try again in a minute.");
    expect(t).toContain("Show me my normal");
  });
});

describe("1 — what just happened", () => {
  const thin: Happened = {
    kind: "video",
    video: {
      id: "v1", yt_video_id: "yt1", title: "Sharpening a chisel", published_at: "2026-08-05T10:00:00Z",
      is_short: false, thumbnail_url: null, view_count: 14, views_per_day: 3, ratio: null, flag: null,
      views_week_delta: null,
    },
    headline: "14 views so far — too few to call it.",
    line: "While your videos sit under about 100 views, one extra viewer swings the whole score, so the team won't name a win or a miss yet.",
    tone: "flat",
    href: "/why/v1",
    actionLabel: "See where viewers left",
    revelation: null,
    noRead: "No read on this one yet — the Editor can show you the second viewers left.",
  };

  it("renders the thin-data answer without inventing a verdict, and still routes on", () => {
    const t = text(<WhatJustHappened h={thin} />);
    expect(t).toContain("What just happened?");
    expect(t).toContain("14 views so far — too few to call it.");
    expect(t).toContain("one extra viewer swings the whole score");
    expect(t).toContain("No read on this one yet");
    expect(t).toContain("See where viewers left");
    expect(t).not.toMatch(BANNED);
    expect(html(<WhatJustHappened h={thin} />)).toContain('href="/why/v1"');
  });

  it("pins the revelation to its receipt when there is a read", () => {
    const t = text(
      <WhatJustHappened
        h={{
          ...thin,
          headline: "Fell short.",
          tone: "crit",
          actionLabel: "Find out why",
          revelation: { provenance: "the team · read Aug 6", text: "Nobody found this in search — every one of your 15 views came from a link you shared" },
          noRead: null,
        }}
      />
    );
    expect(t).toContain("the team · read Aug 6");
    expect(t).toContain("every one of your 15 views came from a link you shared");
    expect(t).toContain("Find out why");
  });

  it("invites the first upload instead of rendering a blank", () => {
    const t = text(<WhatJustHappened h={{ kind: "no-video" }} />);
    expect(t).toContain("Nothing published on this channel yet");
    expect(t).toContain("how it did against your normal");
  });
});

describe("2 — what to do next", () => {
  const action = {
    rec: {
      id: "r1", created_at: "2026-08-06T10:00:00Z", agent: "the Marketer", category: "packaging",
      recommendation: 'Use the title: "The $12 jig that fixed my dovetails"',
      notes: "Your two best titles name the price up front.", status: "open" as const, verdict: null, verdict_kind: null,
      target_type: "channel" as const, target_yt_id: null, confidence: 62,
      evidence: [{ kind: "library" as const, label: "your own winners" }],
      option_type: "safe" as const, result_snapshot: null, updates: null,
    },
    type: "safe" as const,
    effort: "minimal edit",
    href: "/packaging",
    hrefLabel: "Work on the title",
    studioUrl: "https://studio.youtube.com/",
    copyText: "The $12 jig that fixed my dovetails",
    receipt: null,
    why: "Your two best titles name the price up front.",
  };

  const populated: NextUp = { actions: [action], more: 2 };

  it("carries the apply loop on the fix it surfaces", () => {
    const t = text(
      <WhatToDoNext next={populated} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error={null} note={null} />
    );
    expect(t).toContain("Copy");
    expect(t).toContain("Open YouTube Studio");
    expect(t).toContain("I did this");
    expect(t).toContain("minimal edit");
    expect(t).toContain("The safe bet");
    const markup = html(
      <WhatToDoNext next={populated} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error={null} note={null} />
    );
    expect(markup).toContain('href="https://studio.youtube.com/"');
    expect(markup).toContain('href="/packaging"');
    expect(markup).toContain('href="/ledger"'); // the "not one of these?" route
  });

  it("drops the Studio button on a fix Studio can't make, and keeps the rest", () => {
    const nextUpload = {
      ...action,
      effort: "next upload",
      studioUrl: null,
      href: "/why/v1",
      hrefLabel: "See the read behind it",
      rec: { ...action.rec, id: "r2", category: "retention", recommendation: "Cut the intro to five seconds" },
    };
    const t = text(
      <WhatToDoNext next={{ actions: [nextUpload], more: 0 }} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error={null} note={null} />
    );
    expect(t).not.toContain("Open YouTube Studio");
    expect(t).toContain("Copy");
    expect(t).toContain("I did this");
    expect(t).toContain("next upload");
  });

  it("never leaves one tip looking like an order", () => {
    const t = text(
      <WhatToDoNext next={{ actions: [action], more: 0 }} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error={null} note={null} />
    );
    expect(t).toContain("One move is on the table — you decide whether it's worth doing.");
  });

  // EMPTY: nothing waiting — still two typed ways forward, never a blank.
  it("offers two ways to get the next move when nothing is waiting", () => {
    const markup = html(
      <WhatToDoNext next={{ actions: [], more: 0 }} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error={null} note={null} />
    );
    expect(markup).toContain('href="/ideas"');
    expect(markup).toContain('href="/packaging"');
    const t = text(
      <WhatToDoNext next={{ actions: [], more: 0 }} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error={null} note={null} />
    );
    expect(t).toContain("Nothing is waiting on you");
    expect(t).toContain("The videos your viewers already asked for");
    expect(t).toContain("before you publish");
    expect(t).not.toMatch(BANNED);
  });

  it("says when a save failed, and confirms when one landed", () => {
    expect(
      text(<WhatToDoNext next={populated} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error="That didn't save — try again in a moment." note={null} />)
    ).toContain("That didn't save — try again in a moment.");
    expect(
      text(<WhatToDoNext next={populated} onCopy={noop} onApply={noop} applyingId={null} copiedId={null} error={null} note="Marked as done. The Scorekeeper checks it against your views in a week." />)
    ).toContain("Marked as done.");
  });
});

describe("3 — is the advice working", () => {
  const base: Score = {
    lead: "Nothing on the record yet.",
    rows: [],
    counts: { worked: 0, mixed: 0, failed: 0, watched: 0, applied: 0, open: 0 },
  };

  // THIN: nothing judged yet — the honest state, not a fake verdict.
  it("shows the honest 'nothing judged yet' state with the way into the Ledger", () => {
    const t = text(<IsTheAdviceWorking score={base} />);
    expect(t).toContain("Is the advice working?");
    expect(t).toContain("Nothing on the record yet.");
    expect(t).toContain("See every tip and how it landed");
    expect(html(<IsTheAdviceWorking score={base} />)).toContain('href="/ledger"');
  });

  it("stamps a watched tip 'too early to judge' in neutral ink", () => {
    const score: Score = {
      ...base,
      lead: "1 tip applied and being watched.",
      rows: [{ id: "1", text: "Cut the intro to five seconds", chip: { cls: "mut", label: "too early to judge — day 3 of 7" }, shift: null, measuredOn: null }],
    };
    const markup = html(<IsTheAdviceWorking score={score} />);
    expect(markup).toContain('class="pill mut"');
    expect(markup).not.toContain('class="pill warn"');
    expect(text(<IsTheAdviceWorking score={score} />)).toContain("too early to judge — day 3 of 7");
  });

  it("shows the before→after pair beside the verdict it earned", () => {
    const score: Score = {
      ...base,
      lead: "1 worked · 0 mixed · 0 didn't — measured against your own views.",
      rows: [{ id: "1", text: "Retitle it around the price", chip: { cls: "good", label: "✓ worked" }, shift: { before: 41, after: 128, unit: "views a day" }, measuredOn: "The $12 jig" }],
    };
    const t = text(<IsTheAdviceWorking score={score} />);
    expect(t).toContain("✓ worked");
    expect(t).toContain("41 → 128 views a day");
    expect(t).not.toMatch(BANNED);
  });
});
