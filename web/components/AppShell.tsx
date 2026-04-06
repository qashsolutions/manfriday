"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Sidebar from "./Sidebar";
import ThemeToggle from "./ThemeToggle";

/** Auth-related route prefixes that should bypass the sidebar shell. */
const AUTH_ROUTES = ["/signup", "/callback", "/setup", "/login"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  // Auth pages render without sidebar chrome
  if (isAuthRoute) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-64 bg-surface-1 border-r border-surface-3
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden"}
        `}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-surface-0/80 backdrop-blur-sm border-b border-surface-3 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-gray-400 hover:text-primary transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-primary tracking-tight">ManFriday</h1>

          {/* Right side: theme toggle + auth */}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/signup"
              className="text-sm text-secondary hover:text-primary px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>

        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
