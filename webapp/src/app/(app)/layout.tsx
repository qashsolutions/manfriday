"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SEATS } from "@/lib/team";

const NAV = [
  { href: "/desk", label: "The Desk" },
  { href: "/why", label: "Why videos win or die" },
  { href: "/packaging", label: "Titles & thumbnails" },
  { href: "/ideas", label: "Idea list" },
  { href: "/scout", label: "Compare with any video" },
  { href: "/research", label: "Research a topic" },
  { href: "/ledger", label: "The Ledger" },
  { href: "/reports", label: "Reports" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = supabaseBrowser();
  const [state, setState] = useState<"checking" | "signedout" | "ready">("checking");
  const [email, setEmail] = useState<string>("");

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

    // 30 minutes of inactivity signs the user out (timestamp shared across tabs).
    const KEY = "mf-last-active";
    const LIMIT = 30 * 60_000;
    const bump = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch {} };
    const expired = () => {
      try {
        const last = Number(localStorage.getItem(KEY) ?? 0);
        return last > 0 && Date.now() - last > LIMIT;
      } catch { return false; }
    };
    const signOutIdle = async () => {
      try { localStorage.removeItem(KEY); } catch {}
      await supabase.auth.signOut();
      router.replace("/settings?timeout=1");
    };
    if (expired()) { signOutIdle(); return; }
    bump();
    let lastBump = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastBump > 15_000) { lastBump = now; bump(); }
    };
    const events = ["pointerdown", "keydown", "scroll", "visibilitychange"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const idleCheck = setInterval(() => { if (expired()) signOutIdle(); }, 60_000);

    return () => {
      sub.subscription.unsubscribe();
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(idleCheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed out, anywhere but /settings? That's where the sign-in lives.
  useEffect(() => {
    if (state === "signedout" && pathname !== "/settings") router.replace("/settings");
  }, [state, pathname, router]);

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
        <div className="quiet">Loading…</div>
      </div>
    );
  }

  const locked = state === "signedout";

  return (
    <div className="shell">
      <aside className="rail">
        <Link className="logo" href={locked ? "/settings" : "/desk"}><i />manfriday</Link>
        <nav>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`${!locked && pathname.startsWith(n.href) ? "on" : ""} ${locked ? "lock" : ""}`.trim()}
              aria-disabled={locked || undefined}
              tabIndex={locked ? -1 : undefined}
            >
              {n.label}
            </Link>
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
        <div style={{ marginTop: "auto", padding: "14px 20px 0", fontSize: 11.5 }}>
          <Link href="/settings" style={{ color: "var(--ink3)", textDecoration: "none" }}>
            Settings · Your data
          </Link>
        </div>
      </aside>
      <div>
        <div className="main">
          <div className="topbar">
            <span className="chan"><span className="ava" />{locked ? "Signed out" : (email || "Your account")}</span>
            <span className="sp" />
            <button className="iconbtn" onClick={toggleTheme} title="Switch light/dark" aria-label="Switch theme">◐</button>
            <Link href="/settings" className="iconbtn" title="Settings" aria-label="Settings">⚙</Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
