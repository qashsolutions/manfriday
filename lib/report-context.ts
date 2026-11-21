"use client";

/** What the "Something wrong?" button attaches to a report, so a tester never
 *  has to describe what we could have recorded: the item on screen, the last
 *  error the app showed them, and their device. Kept in memory only — nothing
 *  here is stored or sent until the user presses Send, and the sheet shows
 *  them exactly what goes with it. */

import { useEffect } from "react";

export type ReportItem = { kind: "pick"; id: string; label?: string };
export type ShownError = { message: string; at: number; page: string };
export type ReportContext = {
  item?: ReportItem;
  lastError?: ShownError;
  device: { userAgent: string; viewport: string; timezone: string; language: string };
};

/** Errors older than this are probably not what the report is about. */
const ERROR_RELEVANCE_MS = 30 * 60 * 1000;

let lastError: ShownError | null = null;
let item: ReportItem | null = null;
let installed = false;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const here = () => (typeof window === "undefined" ? "" : window.location.pathname);

/** Call wherever the app shows an error message to the user. */
export function noteError(message: string | null | undefined) {
  if (!message) return;
  lastError = { message: clip(String(message), 500), at: Date.now(), page: here() };
}

/** Screens with one obvious subject (the top card in Picks) declare it here. */
export function useReportItem(next: ReportItem | null) {
  const key = next ? `${next.kind}:${next.id}` : "";
  useEffect(() => {
    item = next;
    return () => {
      if (item && `${item.kind}:${item.id}` === key) item = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Crashes and unhandled failures count as errors the user saw. Installed once. */
export function installErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => noteError(e.message || "Unexpected error"));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: unknown } | undefined;
    noteError(typeof r?.message === "string" ? r.message : String(e.reason ?? "Unexpected error"));
  });
}

/** The context as of now. */
export function snapshot(now = Date.now()): ReportContext {
  const ctx: ReportContext = {
    device: {
      userAgent: clip(navigator.userAgent, 300),
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      language: navigator.language ?? "",
    },
  };
  if (item) ctx.item = item;
  if (lastError && now - lastError.at < ERROR_RELEVANCE_MS) ctx.lastError = lastError;
  return ctx;
}

/** A short browser name for the sheet ("Chrome on macOS"); the full string is sent. */
export function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
