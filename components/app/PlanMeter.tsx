"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { meterChip, type BillingView } from "@/lib/billing-copy";

const TONE: Record<string, string> = { ok: "var(--faint)", low: "var(--amber)", out: "var(--accent)", warn: "var(--amber)" };

/** Landing v2: the plan meter is the only plan-aware chrome in the app. */
export function PlanMeter() {
  const billing = useQuery(api.billing.myBilling) as BillingView | null | undefined;
  if (!billing) return null;
  const chip = meterChip(billing);
  return (
    <Link
      href="/settings#s-plan"
      title={chip.title}
      className="mono"
      style={{
        fontSize: 10.5,
        letterSpacing: "0.08em",
        color: TONE[chip.tone],
        border: `1px solid ${chip.tone === "ok" ? "var(--edge-2)" : TONE[chip.tone]}`,
        borderRadius: 999,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {chip.text}
    </Link>
  );
}
