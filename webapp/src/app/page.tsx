"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SiteHeader, SiteFooter } from "@/components/Site";

/** Public landing page. Signed-in visitors skip straight to their Desk —
    the marketing is for people who don't have a team yet. */

const STATS: [string, string, string][] = [
  ["52%", "of creators report burnout — money strain is the top driver", "Billion Dollar Boy · 2025"],
  ["41%", "say time is their #1 challenge — ahead of marketing", "Gusto · Simply Business · 2025"],
  ["<$15K", "what most creators earn a year, at any follower count", "Influencer Marketing Hub · 2025"],
  ["#1", "business threat named: algorithm volatility — not rivals", "eMarketer · 2025"],
];

const TEAM: { name: string; role: string; soon?: boolean }[] = [
  { name: "Retention Analyst", role: "Reads where viewers stop watching on every video — and hands you the why and the fix for the next one." },
  { name: "Packaging Analyst", role: "Grades your title before you publish — against your own winners, not generic advice." },
  { name: "Audience Analyst", role: "Reads your comments and turns what viewers literally ask for into your idea list, receipts attached." },
  { name: "Scorekeeper", role: "Writes every tip down, then checks your numbers and calls the result honestly — misses included." },
  { name: "Scout", role: "Watches channels like yours for moves worth learning from.", soon: true },
  { name: "Researcher", role: "Digs into any topic or video you point at and reports back.", soon: true },
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
          <span className="eyebrow">An AI analyst team for the business of one</span>
          <h1>Creators run real businesses.<br />Most run them blind.</h1>
          <p className="defn">man friday (n.) — the trusted right hand who handles everything.</p>
          <p className="sub">
            The biggest channels employ analysts to read their numbers and call the next move.
            manfriday gives you that team: six analysts working from your channel&apos;s own data —
            why videos win or die, what to title next, what your viewers already asked you to make.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/login" className="btn btn-acc btn-lg">Meet your team — free in early access</Link>
            <Link href="#how" className="btn btn-ghost btn-lg">See how it works</Link>
          </div>
          <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink3)" }}>
            Read-only access to your channel · first results in about two minutes · disconnect in one click
          </p>
        </section>

        <section className="statband" aria-label="Why this exists">
          {STATS.map(([n, d, src]) => (
            <div className="s" key={n}>
              <b>{n}</b>
              <span>{d}</span>
              <i>{src}</i>
            </div>
          ))}
        </section>

        <section className="site-section" id="team">
          <span className="eyebrow">The team</span>
          <h2>Six analysts. One channel: yours.</h2>
          <p className="lead">
            No dashboards to decode, no jargon. Each analyst does one job a big channel would hire
            for — and explains every call in plain English.
          </p>
          <div className="teamgrid">
            {TEAM.map((m) => (
              <div className="m" key={m.name}>
                <b>{m.name}{m.soon && <span className="pill mut">coming online next</span>}</b>
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
          <p className="lead">
            Every tip the team gives is written to a ledger with your numbers at that moment.
            Apply it, and the Scorekeeper compares before and after — then calls it honestly:
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span className="pill good">✓ worked</span>
            <span className="pill warn">~ mixed</span>
            <span className="pill crit">✕ didn&apos;t work</span>
          </div>
          <p className="lead" style={{ marginBottom: 0 }}>
            Misses included. A team that hides its misses can&apos;t be trusted about its wins —
            and when your numbers are too small to judge, it says so instead of guessing.
          </p>
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
