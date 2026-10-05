"use client";

import { useEffect, useState } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearanceFor, type ClerkMode } from "@/lib/clerk-appearance";

/** Clerk's components follow the page: white card in light mode, graphite in
 *  dark, and they switch when the header toggle does. The root layout stamps
 *  data-mode on <html> before first paint; we read it and watch for changes. */
export function ClerkTheme({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ClerkMode>("dark");

  useEffect(() => {
    const read = (): ClerkMode => (document.documentElement.dataset.mode === "light" ? "light" : "dark");
    setMode(read());
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
    return () => observer.disconnect();
  }, []);

  return <ClerkProvider appearance={clerkAppearanceFor(mode)}>{children}</ClerkProvider>;
}
