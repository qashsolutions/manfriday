"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SEATS } from "@/lib/team";
import { IconTheme, IconSettings, IconLocked } from "@/components/ChromeIcons";

/** The navigation is the creator's own cycle, not a list of tools: work out
    why the last video did what it did, decide what to make next, then check
    whether it worked. Every route keeps its URL — this is grouping only. */
const NAV: { step: string | null; items: { href: string; label: string; sub?: boolean }[] }[] = [
  { step: null, items: [{ href: "/desk", label: "Today" }] },
  {
    step: "Step 1 · Why",
    items: [
      { href: "/why", label: "Why it won or died" },
      { href: "/scout", label: "Theirs vs yours" },
    ],
  },
  {
    step: "Step 2 · Next",
    items: [
      { href: "/ideas", label: "What to make next" },
      { href: "/research", label: "Research a topic", sub: true },
      { href: "/packaging", label: "Titles & thumbnails" },
    ],
  },
  {
    step: "The Score",
    items: [
      { href: "/ledger", label: "The Ledger" },
      { href: "/reports", label: "Your weekly report" },
    ],
  },
];

/** The strip in the topbar: where this screen sits in the week, and what
    that step is worth. Each chip is also the door into that step. On phones
    the same four become the bottom bar — `short` is the name that fits
    there, and the step's line stays up top. */
const CYCLE = [
  { key: "today", href: "/desk", label: "Today", short: "Today", num: null,
    line: "today's numbers, and the one move they point to" },
  { key: "why", href: "/why", label: "Why", short: "Why", num: "1",
    line: "where viewers left, and why some videos won" },
  { key: "next", href: "/ideas", label: "Next", short: "Next", num: "2",
    line: "what to make next, and the title that gets it found" },
  { key: "score", href: "/ledger", label: "The Score", short: "Score", num: "3",
    line: "which tips actually moved your views" },
] as const;

/** Desktop-tier screens (DESIGN.md §17): built for a big screen because the
    work is side-by-side, readable on a phone anyway. They get one quiet note
    there — never a gate. Phone-tier screens get nothing extra. */
const DESKTOP_TIER = ["/packaging", "/scout"];

/** Which step a path belongs to. Settings and tuning sit outside the cycle,
    so nothing is highlighted there. */
function stepFor(pathname: string): string | null {
  if (pathname.startsWith("/desk")) return "today";
  if (pathname.startsWith("/why") || pathname.startsWith("/scout")) return "why";
  if (pathname.startsWith("/ideas") || pathname.startsWith("/research") || pathname.startsWith("/packaging")) return "next";
  if (pathname.startsWith("/ledger") || pathname.startsWith("/reports")) return "score";
  return null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = supabaseBrowser();
  const [state, setState] = useState<"checking" | "signedout" | "ready">("checking");
  const [email, setEmail] = useState<string>("");
  // Phones reach the full grouped nav through the same rail, slid over.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    // Signed out (or MFA pending)? The app frame stays, the rail locks, and
    // /settings hosts the sign-in inline — every other path goes there.
    const evaluate = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setState("signedout"); return; }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setState("signedout"); // the settings page shows the MFA step inline
        return;
      }
      setEmail(session.user.email ?? "");
      setState("ready");
    };
    evaluate();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { evaluate(); });
    return () => { sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed out, anywhere but /settings? That's where the sign-in lives.
  useEffect(() => {
    if (state === "signedout" && pathname !== "/settings") router.replace("/settings");
  }, [state, pathname, router]);

  // The phone nav closes when you've gone somewhere, and on Escape.
  useEffect(() => { setNavOpen(false); }, [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [navOpen]);

  function toggleTheme() {
    const root = document.documentElement;
    const current =
      root.getAttribute("data-theme") ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("mf-theme", next); } catch {}
  }

  if (state === "checking") {
    return (
      <div className="authpage">
        <div className="quiet">Getting your team ready…</div>
      </div>
    );
  }

  const locked = state === "signedout";
  const step = stepFor(pathname);

  return (
    <div className="shell">
      <aside className={`rail${navOpen ? " open" : ""}`} id="railnav">
        <Link className="logo" href={locked ? "/settings" : "/desk"}><i />manfriday</Link>
        <nav aria-label="Your week">
          {NAV.map((g) => (
            <div key={g.step ?? "home"}>
              {g.step && <div className="sect">{g.step}</div>}
              {g.items.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={[
                    n.sub ? "sub" : "",
                    !locked && pathname.startsWith(n.href) ? "on" : "",
                    locked ? "lock" : "",
                  ].filter(Boolean).join(" ")}
                  aria-disabled={locked || undefined}
                  tabIndex={locked ? -1 : undefined}
                >
                  {n.label}
                  {locked && <IconLocked />}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sect">Your team of six</div>
        <div className="team">
          {SEATS.map((s) => (
            <div className="an" key={s.key} style={{ alignItems: "flex-start" }}>
              <span className="st idle" style={{ marginTop: 5 }} />
              <div>
                {s.name}
                <div style={{ fontSize: 10.5, color: "var(--ink3)", lineHeight: 1.35, marginTop: 1 }}>
                  {s.job}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="foot">
          {!locked && <Link href="/profile">Tune your team</Link>}
          <Link href="/settings">Settings · your data</Link>
        </div>
      </aside>
      {navOpen && (
        <div className="modalback railback" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}
      <div>
        <div className="main">
          <div className="topbar">
            <Link className="logo mlogo" href={locked ? "/settings" : "/desk"}><i />manfriday</Link>
            {!locked && (
              <div className="cycwrap">
                <nav className="cyc" aria-label="Where you are in your week">
                  {CYCLE.map((c, i) => (
                    <Fragment key={c.key}>
                      {i > 0 && <span className="arw" aria-hidden="true" />}
                      <Link
                        href={c.href}
                        className={step === c.key ? "on" : ""}
                        aria-current={step === c.key ? "step" : undefined}
                      >
                        {c.num && <i>{c.num}</i>}
                        {c.label}
                      </Link>
                    </Fragment>
                  ))}
                </nav>
                <span className="cycnow">
                  {CYCLE.find((c) => c.key === step)?.line
                    ?? "your week in three steps — start with why your last video did what it did"}
                </span>
              </div>
            )}
            <span className="sp" />
            <span className="chan">
              <span className="ava" />
              <span className="who">{locked ? "Signed out" : (email || "Your account")}</span>
            </span>
            <button className="iconbtn" onClick={toggleTheme} title="Switch light/dark" aria-label="Switch theme"><IconTheme /></button>
            <Link href="/settings" className="iconbtn" title="Settings" aria-label="Settings"><IconSettings /></Link>
          </div>
          {DESKTOP_TIER.includes(pathname) && (
            <div className="aside-note bigscreen">
              Best on a bigger screen — comparing images and titles side by side is how you spot
              what makes people click. It all still works here, just stacked.
            </div>
          )}
          {children}
        </div>
      </div>
      {!locked && (
        <nav className="tabs" aria-label="Your week, condensed">
          {CYCLE.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className={step === c.key ? "on" : ""}
              aria-current={step === c.key ? "step" : undefined}
            >
              {c.num && <i>{c.num}</i>}
              {c.short}
            </Link>
          ))}
          <button
            className={navOpen ? "on" : ""}
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            aria-controls="railnav"
          >
            More
          </button>
        </nav>
      )}
    </div>
  );
}
