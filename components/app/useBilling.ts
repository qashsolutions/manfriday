"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { parseBillingError, type BillingView } from "@/lib/billing-copy";

/** The signed-in user's plan, plus the two ways to pay: Checkout and the portal.
 *  Both open Stripe-hosted pages — card details never touch Man Friday. */
export function useBilling() {
  const billing = useQuery(api.billing.myBilling) as BillingView | null | undefined;
  const startCheckout = useAction(api.billing.startCheckout);
  const openPortal = useAction(api.billing.openPortal);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ url: string }>) => {
    setBusy(key);
    setError(null);
    try {
      const { url } = await fn();
      window.location.assign(url);
    } catch (err) {
      setError(parseBillingError(err)?.message ?? "Stripe didn't respond. Try again in a moment.");
      setBusy(null);
    }
  };

  return {
    billing,
    busy,
    error,
    clearError: () => setError(null),
    checkout: (lookupKey: string) => run(lookupKey, () => startCheckout({ lookupKey })),
    portal: () => run("portal", () => openPortal({})),
  };
}
