"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const NAV = [
  { href: "/desk", label: "The Desk" },
  { href: "/why", label: "Why videos win or die" },
  { href: "/packaging", label: "Titles & thumbnails" },
  { href: "/ideas", label: "Idea list" },
  { href: "/ledger", label: "The Ledger" },
  { href: "/reports", label: "Weekly reports" },
];

const TEAM = [
  { name: "Retention Analyst", st: "idle", note: "ready" },
  { name: "Packaging Analyst", st: "idle", note: "ready" },
  { name: "Audience Analyst", st: "idle", note: "ready" },
  { name: "The Scout", st: "idle", note: "ready" },
  { name: "The Researcher", st: "idle", note: "ready" },
  { name: "The Scorekeeper", st: "idle", note: "ready" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = supabaseBrowser();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        router.replace("/login");
        return;
      }
      setEmail(session.user.email ?? "");
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: unknown) => {
        if (!session) router.replace("/login");
      }
    );
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleTheme() {
    const root = document.documentElement;
    const current =
      root.getAttribute("data-theme") ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("mf-theme", next); } catch {}
  }

  if (!ready) {
    return (
      <div className="authpage">
        <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading your desk…</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="rail">
        <Link className="logo" href="/desk"><i />manfriday</Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? "on" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sect">Your team of six</div>
        <div className="team">
          {TEAM.map((t) => (
            <div className="an" key={t.name}>
              <span className={`st ${t.st}`} />
              {t.name}
              <em>{t.note}</em>
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
            <span className="chan"><span className="ava" />{email || "Your account"}</span>
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
