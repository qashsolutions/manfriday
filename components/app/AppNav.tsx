"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Bolt, Wordmark } from "@/components/ui/Logo";
import { PlanMeter } from "./PlanMeter";

const TABS = [
  { href: "/picks", label: "PICKS" },
  { href: "/calendar", label: "CALENDAR" },
  { href: "/analytics", label: "ANALYTICS" },
  { href: "/settings", label: "SETTINGS" },
];

export function AppNav() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const ensure = useMutation(api.users.ensureCurrent);

  useEffect(() => {
    if (isSignedIn) {
      ensure({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => {});
    }
  }, [isSignedIn, ensure]);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 32px",
        borderBottom: "1px solid var(--edge)",
      }}
    >
      <Link href="/" aria-label="Man Friday home" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink)" }}>
        <Bolt size={18} />
        <Wordmark size={15} />
      </Link>
      <nav className="mono" style={{ display: "flex", gap: 24, fontSize: 12, letterSpacing: "0.08em", alignItems: "center" }} aria-label="App">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            style={{ color: pathname.startsWith(t.href) ? "var(--ink)" : "var(--faint)" }}
          >
            {t.label}
          </Link>
        ))}
        <PlanMeter />
        <UserButton />
      </nav>
    </header>
  );
}
