"use client";

import { SiteHeader, SiteFooter } from "@/components/Site";
import { AuthCard } from "@/components/AuthCard";

/** Kept for old links and the inactivity redirect — the same card renders
    inline on /settings (and any app page) when signed out. */
export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <div className="authpage"><AuthCard /></div>
      <SiteFooter />
    </>
  );
}
