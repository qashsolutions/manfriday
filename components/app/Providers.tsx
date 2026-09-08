"use client";

import { useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

export function AppProviders({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => (url ? new ConvexReactClient(url) : null), []);
  if (!client) {
    // Deploy-config guard: the app shell needs NEXT_PUBLIC_CONVEX_URL (see vercel_var.md)
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--dim)" }}>
        <p className="mono" style={{ color: "var(--amber)", fontSize: 12, letterSpacing: "0.1em" }}>
          CONFIG NEEDED
        </p>
        <p>NEXT_PUBLIC_CONVEX_URL is not set for this deployment.</p>
      </div>
    );
  }
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
