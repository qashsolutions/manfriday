"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/Site";
import {
  IconRetention, IconPackaging, IconAudience,
  IconScorekeeper, IconScout, IconResearcher,
} from "@/components/TeamIcons";

/** Public landing page. Signed-in visitors skip straight to their Desk —
    the marketing is for people who don't have a team yet. */

const STATS: [string, string, string][] = [
  ["52%", "of creators report burnout — money strain is the top driver", "Billion Dollar Boy · 2025"],
  ["41%", "say time is their #1 challenge — ahead of marketing", "Gusto · Simply Business · 2025"],
  ["<$15K", "what most creators earn a year, at any follower count", "Influencer Marketing Hub · 2025"],
  ["#1", "business threat named: algorithm volatility — not rivals", "eMarketer · 2025"],
];

const TEAM: { icon: React.ReactNode; name: string; role: string }[] = [
  { icon: <IconRetention />, name: "Retention Analyst", role: "Finds the exact moments viewers stop watching — and hands you the why and the fix for the next upload." },
  { icon: <IconPackaging />, name: "Packaging Analyst", role: "Grades your title before you publish — against your own winners, not generic advice." },
  { icon: <IconAudience />, name: "Audience Analyst", role: "Reads your comments and turns what viewers literally ask for into your idea list, receipts attached." },
  { icon: <IconScorekeeper />, name: "Scorekeeper", role: "Writes every tip down, then checks your numbers and calls the result honestly — misses included." },
  { icon: <IconScout />, name: "Scout", role: "Watches channels like yours and flags the moves worth learning from." },
  { icon: <IconResearcher />, name: "Researcher", role: "Digs into any topic or video you point at and reports back in plain English." },
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
          <span className="eyebrow">For solo YouTube creators</span>
          <h1>Big channels have an<br />analyst team. Now you do.</h1>
          <p className="sub">
            Six analysts on your channel&apos;s real numbers — why videos win or die,
            what to title next, and what your viewers already asked you to make.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/login" className="btn btn-acc btn-lg">Meet your team — free in early access</Link>
            <Link href="#team" className="btn btn-ghost btn-lg">See what they do</Link>
          </div>
          <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink3)" }}>
            Read-only access · first results in about two minutes · disconnect in one click
          </p>
        </section>

        <section className="site-section" style={{ paddingTop: 34 }}>
          <span className="eyebrow">Why we exist</span>
          <h2>Creators run real businesses. Most run them blind.</h2>
          <div className="statband">
            {STATS.map(([n, d, src]) => (
              <div className="s" key={n}>
                <b>{n}</b>
                <span>{d}</span>
                <i>{src}</i>
              </div>
            ))}
          </div>
        </section>

        <section className="site-section" id="team">
          <span className="eyebrow">The team</span>
          <h2>Six analysts. One channel: yours.</h2>
          <p className="lead">
            Each one does a job the biggest channels hire for — and explains every call in
            plain English. No dashboards to decode, no jargon.
          </p>
          <div className="teamgrid">
            {TEAM.map((m) => (
              <div className="m" key={m.name}>
                <div className="ic">{m.icon}</div>
                <b>{m.name}</b>
                <p>{m.role}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="site-section" id="how">
          <span className="eyebrow">How it works</span>
          <h2>Two clicks to your first real answer.</h2>
          <div className="steps" style={{ marginTop: 20 }}>
            <div className="st-card">
              <b>Connect your channel</b>
              <p>One click, read-only — we can look, we can&apos;t touch. Your data stays yours; delete your account and everything goes with it.</p>
            </div>
            <div className="st-card">
              <b>Get your first read</b>
              <p>In about two minutes the team works out your normal — what a video of yours usually does — and flags your real wins and misses against it.</p>
            </div>
            <div className="st-card">
              <b>Ask the analysts</b>
              <p>Open any video for the retention read. Grade tomorrow&apos;s title. Have your comments mined for ideas. Every tip lands in your Ledger.</p>
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
          <Link href="/login" className="btn btn-acc btn-lg">Get your team</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
