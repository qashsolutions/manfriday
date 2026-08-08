"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/Site";
import { HeroPreview } from "@/components/HeroPreview";
import { VizWhy, VizNext, VizScore } from "@/components/HowVisuals";
import { TEAM, type Seat } from "@/lib/team";
import { SEAT_ICONS } from "@/components/TeamIcons";

/** Public landing page. Signed-in visitors skip the marketing: straight to
    their Desk if a channel is connected, to Settings (the first-run front
    door) if not.

    The page tells one story in one order — first the why, then the next, then
    the score — the same three steps the signed-in shell runs on. Every claim
    here has a shipped surface behind it. */

/** The two steps and the score. Titles match the app's own nav headings so a
    visitor meets the same three words again after signing in. */
const STEPS: { step: string; viz: React.ReactNode; title: string; body: string }[] = [
  {
    step: "Step 1 · Why",
    viz: <VizWhy />,
    title: "Why it won or died",
    body:
      "The exact second viewers left, why YouTube showed it to fewer people than the one before it, " +
      "and how it did against your normal — so you know what to change and what to repeat.",
  },
  {
    step: "Step 2 · Next",
    viz: <VizNext />,
    title: "What to make, and how to package it",
    body:
      "Ideas your viewers already asked for in the comments, an opening written against the seconds " +
      "they left, and title options graded against your own winners. Always 2–3 choices — you make the call.",
  },
  {
    step: "The Score",
    viz: <VizScore />,
    title: "Whether it actually worked",
    body:
      "Every pick goes in the Ledger with your views at that moment. A week later the Scorekeeper " +
      "compares — worked, mixed, or didn't — and next week's advice starts from what already worked on your channel.",
  },
];

/** The six seats under the step where their work lands (DESIGN.md §12 for the
    names and job lines — both verbatim from lib/team.ts). */
const TEAM_BY_STEP: { step: string; seats: Seat[] }[] = [
  { step: "Step 1 · Why", seats: [TEAM.editor, TEAM.scout] },
  { step: "Step 2 · Next", seats: [TEAM.listener, TEAM.marketer, TEAM.researcher] },
  { step: "The Score", seats: [TEAM.scorekeeper] },
];

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    supabaseBrowser().auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      // Any failure of the status check falls back to /settings, where the
      // connection state is shown and fixable.
      let connected = false;
      try {
        const r = await fetch("/api/connections/status", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (r.ok) connected = (await r.json()).connected === true;
      } catch {}
      router.replace(connected ? "/desk" : "/settings");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SiteHeader />
      <main className="site-wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">For all content creators</span>
            <h1>
              First we tell you <em>why</em>. Then we coach <em>what&apos;s next</em> — and keep score.
            </h1>
            <p className="sub">
              <b>Why your last video died</b> — the exact second viewers left, and why YouTube showed it
              to fewer people than the one before it. <b>Then what to make next</b> — the ideas your
              viewers asked for in your comments, and the title that gets it found; 2–3 choices every
              time, you make the call. A week later the Scorekeeper tells you what your pick did to your views.
            </p>
            <div className="herocta">
              <Link href="/settings" className="btn btn-acc btn-lg">Connect your channel</Link>
              <Link href="#team" className="btn btn-ghost btn-lg">Meet the team</Link>
            </div>
            <p className="ctanote">
              Free while manfriday is in early access — your first read lands about two minutes after you connect.
            </p>
          </div>
          <HeroPreview />
        </section>

        <section className="site-section" id="how">
          <span className="eyebrow">How it works</span>
          <h2>First the why. Then the next. Then the score.</h2>
          <p className="lead">
            Same order every week: work out what just happened, decide what to do about it, then find
            out whether it worked.
          </p>
          <div className="flow">
            {STEPS.map((s) => (
              <div className="f" key={s.step}>
                <div className="viz">{s.viz}</div>
                <span className="k">{s.step}</span>
                <b>{s.title}</b>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="site-section" id="team">
          <span className="eyebrow">The team</span>
          <h2>Six analysts. One job each. All on your side.</h2>
          <p className="lead">
            Each seat has one job and says it in their own words — and every call comes from your own
            numbers, as choices you pick from.
          </p>
          <div className="teamgrid">
            {TEAM_BY_STEP.flatMap(({ step, seats }) =>
              seats.map((s) => {
                const Icon = SEAT_ICONS[s.key];
                return (
                  <div className="m" key={s.key}>
                    <div className="ic"><Icon /></div>
                    <b>
                      {s.name}
                      <span className="pill mut">{step}</span>
                    </b>
                    <q>{s.job}</q>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="site-section" id="honest">
          <span className="eyebrow">Why trust it</span>
          <h2>Advice that never gets checked is just a horoscope.</h2>
          <div className="grid g2" style={{ marginTop: 18, alignItems: "start" }}>
            <div className="trust">
              <div className="n">
                <span className="dot" aria-hidden>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="4" y="3.5" width="16" height="17" rx="3" />
                    <path d="M8 9h8M8 13h5" />
                  </svg>
                </span>
                <div>
                  <b>Written down</b>
                  <span>Every tip lands in the Ledger — with your numbers at that exact moment.</span>
                </div>
              </div>
              <div className="n">
                <span className="dot" aria-hidden>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M5 20V12M12 20V6M19 20V9" />
                    <path d="M3.5 3.5h6" strokeDasharray="1 3" />
                  </svg>
                </span>
                <div>
                  <b>Checked against reality</b>
                  <span>You apply it, the Scorekeeper compares before and after. No vibes — your numbers.</span>
                </div>
              </div>
              <div className="n">
                <span className="dot bad" aria-hidden>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </span>
                <div>
                  <b>Misses stay on the record</b>
                  <span>A team that hides its misses can&apos;t be trusted about its wins. Too little data? You hear &quot;too early to judge&quot; — never a guess.</span>
                </div>
              </div>
            </div>
            <div className="card ldemo">
              <span className="k">Sample — how a checked tip reads</span>
              <div style={{ marginTop: 8 }}>
                <div className="row">
                  <b>Say what they get in the title</b>
                  <span className="shift num">41/day → 128/day</span>
                  <span className="pill good">✓ worked · 3×</span>
                </div>
                <div className="row">
                  <b>Open on the result, not the intro</b>
                  <span className="shift num">held 12% more viewers</span>
                  <span className="pill good">✓ worked</span>
                </div>
                <div className="row">
                  <b>Add an end-screen poll</b>
                  <span className="shift num">no change</span>
                  <span className="pill crit">✕ didn&apos;t work</span>
                </div>
              </div>
              <div className="vbar">
                <span style={{ flex: 6, background: "var(--good)" }} />
                <span style={{ flex: 2, background: "var(--warn)" }} />
                <span style={{ flex: 2, background: "var(--crit)" }} />
              </div>
              <p className="vbarnote">
                Green worked, amber mixed, red didn&apos;t — every verdict stays on the record.
              </p>
            </div>
          </div>
        </section>

        <div className="quoteband">
          <h2>Every winner has an analyst.<br />The business of one doesn&apos;t. Yet.</h2>
          <Link href="/settings" className="btn btn-acc btn-lg">Connect your channel</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
