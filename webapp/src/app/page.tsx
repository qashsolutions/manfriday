"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/Site";
import { HeroPreview } from "@/components/HeroPreview";
import { VizConnect, VizBaseline, VizOptions } from "@/components/HowVisuals";
import { SEATS } from "@/lib/team";
import { SEAT_ICONS } from "@/components/TeamIcons";

/** Public landing page. Signed-in visitors skip straight to Settings —
    their home base — the marketing is for people who don't have a team yet. */

const STATS: [string, string][] = [
  ["52%", "of creators report burnout — money strain is the top driver"],
  ["41%", "say time is their #1 challenge — ahead of marketing"],
  ["<$15K", "what most creators earn a year, at any follower count"],
  ["#1", "business threat: the algorithm changing — not rivals"],
];

const TEAM: { icon: React.ReactNode; name: string; says: string }[] = SEATS.map((s) => {
  const Icon = SEAT_ICONS[s.key];
  return { icon: <Icon />, name: s.name, says: s.job };
});

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    supabaseBrowser().auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/settings");
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
            <h1>Big channels have an analyst team. <span style={{ color: "var(--acc)" }}>Now you do.</span></h1>
            <p className="sub">
              <b style={{ fontSize: "1.07em" }}>Why your last video died. What to make next. Which title wins.</b>
              <br />
              Six analysts answer from your own numbers, tuned to the audience you want —
              always choices, never orders.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/settings" className="btn btn-acc btn-lg">Start your one-week trial</Link>
              <Link href="#team" className="btn btn-ghost btn-lg">Meet the team</Link>
            </div>
            <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink3)" }}>
              One-week trial — every feature included
            </p>
          </div>
          <HeroPreview />
        </section>

        <section className="site-section" style={{ paddingTop: 30 }}>
          <span className="eyebrow">Why we exist</span>
          <h2>Creators run real businesses. Most run them blind.</h2>
          <div className="statband">
            {STATS.map(([n, d]) => (
              <div className="s" key={n}>
                <b>{n}</b>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="site-section" id="team">
          <span className="eyebrow">The team</span>
          <h2>Six analysts. One job each. All on your side.</h2>
          <p className="lead">
            Every call comes in plain English, tuned to the audience you&apos;re trying to win —
            with choices, not commands.
          </p>
          <div className="teamgrid">
            {TEAM.map((m) => (
              <div className="m" key={m.name}>
                <div className="ic">{m.icon}</div>
                <b>{m.name}</b>
                <q>{m.says}</q>
              </div>
            ))}
          </div>
        </section>

        <section className="site-section" id="how">
          <span className="eyebrow">How it works</span>
          <h2>Two clicks to your first real answer.</h2>
          <div className="flow">
            <div className="f">
              <div className="viz"><VizConnect /></div>
              <b>Connect</b>
              <p>One click. Read-only — we can look, never touch.</p>
            </div>
            <div className="f">
              <div className="viz"><VizBaseline /></div>
              <b>See your normal</b>
              <p>Wins and misses flagged against your own bar, in ~2 minutes.</p>
            </div>
            <div className="f">
              <div className="viz"><VizOptions /></div>
              <b>Pick, publish, verify</b>
              <p>2–3 options each time. You choose — the result gets checked.</p>
            </div>
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
              <span className="k">The Ledger — how a checked tip reads</span>
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
              <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--ink3)" }}>
                Every verdict on the record — green worked, amber mixed, red didn&apos;t.
              </p>
            </div>
          </div>
        </section>

        <div className="quoteband">
          <h2>Every winner has an analyst.<br />The business of one doesn&apos;t. Yet.</h2>
          <Link href="/settings" className="btn btn-acc btn-lg">Start your one-week trial</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
