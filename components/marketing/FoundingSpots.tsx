"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { FOUNDING } from "@/lib/site";

/** The live Founding 200 counter on static marketing pages. Renders nothing
 *  until the real number arrives — never a placeholder. */
export function FoundingSpots({ className }: { className?: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return;
    let alive = true;
    new ConvexHttpClient(url)
      .query(api.billing.foundingSpotsLeft, {})
      .then((r) => alive && setLeft(r.left))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (left === null) return null;
  return <span className={className}>{left === 0 ? "All spots taken" : `${left} of ${FOUNDING.cap} spots left`}</span>;
}
