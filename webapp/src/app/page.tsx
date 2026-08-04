"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/Site";
import { HeroPreview } from "@/components/HeroPreview";
import { VizConnect, VizBaseline, VizOptions } from "@/components/HowVisuals";
import {
  IconRetention, IconPackaging, IconAudience,
  IconScorekeeper, IconScout, IconResearcher,
} from "@/components/TeamIcons";

/** Public landing page. Signed-in visitors skip straight to their Desk —
    the marketing is for people who don't have a team yet. */

const STATS: [string, string][] = [
  ["52%", "of creators report burnout — money strain is the top driver"],
  ["41%", "say time is their #1 challenge — ahead of marketing"],
  ["<$15K", "what most creators earn a year, at any follower count"],
  ["#1", "business threat: the algorithm changing — not rivals"],
];

const TEAM: { icon: React.ReactNode; name: string; says: string }[] = [
  { icon: <IconRetention />, name: "Retention Analyst", says: "I find the exact second viewers bail — and tell you what to change so they don't next time." },
  { icon: <IconPackaging />, name: "Packaging Analyst", says: "Before you publish, I grade your title against your own winners — and hand you three rewrites to choose from." },
  { icon: <IconAudience />, name: "Audience Analyst", says: "I read your comments and bring you what your audience is already asking for — receipts attached." },
  { icon: <IconScorekeeper />, name: "Scorekeeper", says: "I write every tip down and check it against your numbers. When one doesn't work, I say so." },
  { icon: <IconScout />, name: "Scout", says: "I watch creators like you and flag the moves worth learning from." },
  { icon: <IconResearcher />, name: "Researcher", says: "Point me at any topic or video — I'll come back with the read, in plain English." },
];

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    supabaseBrowser().auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/desk");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SiteHeader />
      <main className="site-wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">For solo content creators</span>
            <h1>Big channels have an analyst team. <span style={{ color: "var(--acc)" }}>Now you do.</span></h1>
            <p className="sub">
              Six analysts on your real numbers — why videos win or die, what to publish next,
              what your audience is asking for. Tuned to who you want to reach, and always
              two or three options to pick from — never orders.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/login" className="btn btn-acc btn-lg">Start your one-week trial</Link>
              <Link href="#team" className="btn btn-ghost btn-lg">Meet the team</Link>
            </div>
            <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink3)" }}>
              One-week trial · read-only access · first results in about two minutes
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
            <div>
              <p className="lead">
                Every tip is written to a ledger with your numbers at that moment. Apply it, and
                the Scorekeeper compares before and after — then calls it honestly.
              </p>
              <p className="lead" style={{ marginBottom: 0 }}>
                Misses included. A team that hides its misses can&apos;t be trusted about its wins —
                and when your numbers are too small to judge, it says so instead of guessing.
              </p>
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
          <Link href="/login" className="btn btn-acc btn-lg">Start your one-week trial</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
