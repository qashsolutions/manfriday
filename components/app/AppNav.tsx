"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Bolt, Wordmark } from "@/components/ui/Logo";
import { PlanMeter } from "./PlanMeter";
import styles from "./AppNav.module.css";

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
  // Operator screen: the only way in used to be typing the URL, which bounced
  // through sign-in and lost you. Team accounts get a tab; nobody else sees it.
  const isAdmin = useQuery(api.admin.amIAdmin);
  const tabs = isAdmin ? [...TABS, { href: "/admin", label: "ADMIN" }] : TABS;

  useEffect(() => {
    if (isSignedIn) {
      ensure({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => {});
    }
  }, [isSignedIn, ensure]);

  return (
    <header className={styles.bar}>
      <Link href="/" aria-label="Man Friday home" className={styles.brand}>
        <Bolt size={18} />
        <span className={styles.wordmark}>
          <Wordmark size={15} />
        </span>
      </Link>
      <nav className={`mono ${styles.tabs}`} aria-label="App">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={styles.tab}
            aria-current={pathname.startsWith(t.href) ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className={styles.account}>
        <span className={styles.meter}>
          <PlanMeter />
        </span>
        <UserButton />
      </div>
    </header>
  );
}
