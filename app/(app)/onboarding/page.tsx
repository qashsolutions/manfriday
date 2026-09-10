"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "../app.module.css";
import { LanguageChip } from "@/components/app/LanguageChip";

const STATUS_COPY: Record<string, string> = {
  pending: "Friday is picking this up…",
  claimed: "Friday is picking this up…",
  analyzing: "Friday is reading your site and writing the brief…",
  drafting: "Brief done — Friday is drafting your first concepts…",
};

export default function OnboardingPage() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation(api.onboarding.submitUrl);
  const request = useQuery(api.onboarding.myLatestRequest);
  const brand = useQuery(api.brands.myBrand);
  const setBrandLanguage = useMutation(api.brands.setLanguage);

  const busy = request && ["pending", "claimed", "analyzing", "drafting"].includes(request.status);

  // The landing hero's URL rides through signup in localStorage (see RememberUrl).
  useEffect(() => {
    try {
      const pending = localStorage.getItem("mf-pending-url");
      if (pending) {
        setUrl((u) => u || pending);
        localStorage.removeItem("mf-pending-url");
      }
    } catch {}
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await submit({ url });
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*Error: /, "") : "Something went wrong");
    }
  };

  return (
    <div className={styles.wrap}>
      <p className="eyebrow">Friday&apos;s first day</p>
      <h1 className={`display ${styles.title}`}>Where does your product live?</h1>
      <p className={styles.sub}>
        Friday reads your site to learn the product, audience, voice, and language — then
        drafts your first ten videos. Everything Friday makes starts from this.
      </p>

      {!busy && (
        <form className={styles.urlRow} onSubmit={onSubmit}>
          <input
            className={styles.urlInput}
            placeholder="yourproduct.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Your product's URL"
          />
          <button type="submit" className="btn btn--accent">
            Analyze →
          </button>
        </form>
      )}
      {error && <p className={styles.error}>{error}</p>}

      {busy && (
        <p className={styles.statusLine}>
          <span className={styles.pulse} />
          {STATUS_COPY[request.status] ?? request.status}
        </p>
      )}

      {request?.status === "failed" && (
        <p className={styles.error}>
          Friday hit a wall reading that site{request.error ? ` (${request.error})` : ""} — try
          another URL.
        </p>
      )}

      {request?.brand && (
        <div className={styles.briefCard}>
          <span className={styles.briefLabel}>FRIDAY&apos;S BRIEF ON YOU</span>
          <span className={styles.briefName}>{request.brand.name}</span>
          <span style={{ color: "var(--dim)", fontSize: 15 }}>{request.brand.oneLiner}</span>
          <span className={`mono ${styles.briefLabel}`}>
            {request.brand.niche} · {request.brand.tone.join(", ")}
          </span>
          {brand && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", marginTop: 6 }}>
              <span className={`mono ${styles.briefLabel}`}>FRIDAY WRITES AND SPEAKS IN</span>
              <LanguageChip
                language={brand.language}
                languageStyle={brand.languageStyle}
                inferred
                onChange={(next) => setBrandLanguage({ brandId: brand.id, ...next })}
              />
            </div>
          )}
        </div>
      )}

      {request?.status === "done" && (
        <>
          <p className={styles.statusLine}>
            <span className={styles.liveDot} /> First concepts are rendering — they appear in
            Picks as they finish.
          </p>
          <Link href="/picks" className="btn btn--accent">
            Open Picks →
          </Link>
        </>
      )}
    </div>
  );
}
