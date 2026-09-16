"use client";

import { useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { Authenticated, AuthLoading, ConvexReactClient, Unauthenticated } from "convex/react";
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

/** Gate for page bodies (the nav stays put).
 *
 *  Until Convex has the Clerk token, every query answers as a signed-out user —
 *  which showed "the feed is empty", "nothing scheduled yet" and "sign in to see
 *  how your posts did" for a beat on every load. Hold the body until auth
 *  resolves so no screen ever lies about the user's own data. */
export function AppAuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div style={{ padding: "72px 24px", textAlign: "center" }}>
          <p className="mono" style={{ fontSize: 12, letterSpacing: "0.1em", color: "var(--faint)" }}>
            LOADING YOUR WORKSPACE…
          </p>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div style={{ padding: "72px 24px", textAlign: "center", color: "var(--dim)" }}>
          <p>
            Your session ended after 60 minutes of inactivity.{" "}
            <a href="/login" style={{ color: "var(--accent)" }}>Sign in</a> to pick up where you left off.
          </p>
        </div>
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}
