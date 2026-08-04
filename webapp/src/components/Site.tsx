"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Header + footer for the public pages (landing, terms, privacy).
    The header is session-aware: signed-in visitors get "Open my Desk". */

export function SiteHeader() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    supabaseBrowser().auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  return (
    <header className="site-header">
      <div className="site-wrap in">
        <Link href="/" className="logo" style={{ textDecoration: "none", fontWeight: 800, fontSize: 15 }}>
          <i />manfriday
        </Link>
        <nav>
          <Link href="/#team">The team</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#honest">Why trust it</Link>
        </nav>
        <div className="cta">
          {signedIn ? (
            <Link href="/desk" className="btn btn-acc btn-sm">Open my Desk</Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link href="/login" className="btn btn-acc btn-sm">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap">
        <div className="cols">
          <div className="col" style={{ maxWidth: 300 }}>
            <span className="logo" style={{ fontWeight: 800, fontSize: 15 }}><i />manfriday</span>
            <p style={{ color: "var(--ink3)", fontSize: 12.5, marginTop: 10, lineHeight: 1.6 }}>
              Your own analyst team. It reads your channel&apos;s real numbers, tells you what&apos;s
              working and what to do next — and every tip gets checked, honestly.
            </p>
          </div>
          <div className="col">
            <b>Product</b>
            <Link href="/#team">The team</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/login">Sign in</Link>
          </div>
          <div className="col">
            <b>Legal</b>
            <Link href="/terms">Terms of service</Link>
            <Link href="/privacy">Privacy policy</Link>
          </div>
        </div>
        <div className="fine">
          manfriday uses YouTube API Services. By connecting a channel you also agree to the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>; Google&apos;s{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> applies to
          Google&apos;s handling of your data. You can revoke manfriday&apos;s access at any time in your{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google security settings</a>.
          <br />© {new Date().getFullYear()} manfriday.app
        </div>
      </div>
    </footer>
  );
}
