"use client";

import { useEffect, useState } from "react";

/** Dark/light switch — one per header. Source of truth is localStorage "mf-mode"
 *  + the data-mode attribute the root layout script stamps on <html> pre-paint. */
export function ModeToggle() {
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    if (document.documentElement.dataset.mode === "light") setMode("light");
  }, []);

  const flip = () => {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    if (next === "light") document.documentElement.dataset.mode = "light";
    else delete document.documentElement.dataset.mode;
    try {
      localStorage.setItem("mf-mode", next);
    } catch {
      // private windows: toggle still works for this page view
    }
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={mode === "dark" ? "Light mode" : "Dark mode"}
      style={{
        background: "transparent",
        border: "1px solid var(--edge-2)",
        borderRadius: 999,
        width: 38,
        height: 38,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "var(--dim)",
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {mode === "dark" ? "☀" : "☾"}
    </button>
  );
}
