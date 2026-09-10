"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./UrlCta.module.css";

/** The hero's call to action: a URL, not a button. Carries the URL through
 *  signup (account creation is step 1, D4) into the onboarding brief. */
export function UrlCta({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) {
      setError("Paste your product's URL to start.");
      return;
    }
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      setError("That doesn't look like a URL yet.");
      return;
    }
    if (!url.hostname.includes(".")) {
      setError("That doesn't look like a URL yet.");
      return;
    }
    setError(null);
    router.push(`/signup?url=${encodeURIComponent(url.toString())}`);
  };

  return (
    <form className={`${styles.form} ${compact ? styles.compact : ""}`} onSubmit={onSubmit} noValidate>
      <div className={styles.row}>
        <svg className={styles.icon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
        <input
          className={styles.input}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://yourproduct.com"
          aria-label="Your product's URL"
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" className={`btn btn--accent ${styles.button}`}>
          Friday, read my site →
        </button>
      </div>
      <p className={`mono ${styles.fine}`} role={error ? "alert" : undefined}>
        {error ?? "Free · no card · your brand brief in about 30 seconds"}
      </p>
    </form>
  );
}
