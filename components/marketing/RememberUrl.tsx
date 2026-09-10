"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/** The landing hero sends `?url=` into signup; account creation is step 1 (D4),
 *  so the URL waits in localStorage for the onboarding brief to pick up. */
export function RememberUrl() {
  const params = useSearchParams();
  useEffect(() => {
    const url = params.get("url");
    if (!url) return;
    try {
      localStorage.setItem("mf-pending-url", url);
    } catch {}
  }, [params]);
  return null;
}
