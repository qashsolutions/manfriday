"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "../app.module.css";
import { LanguageChip } from "@/components/app/LanguageChip";
import { previewLine, stageIndex } from "@/lib/onboarding-copy";

// Each stage says what Friday is doing AND roughly how long it takes, so the
// wait never looks like a hang. Times are the observed p50 of a real batch.
const STAGES: { key: string; label: string; eta: string }[] = [
  { key: "analyzing", label: "Reading your site", eta: "about 20 seconds" },
  { key: "drafting", label: "Writing ten concepts", eta: "about a minute" },
  { key: "rendering", label: "Rendering previews", eta: "a few minutes" },
];

const STATUS_COPY: Record<string, string> = {
  pending: "Friday is picking this up…",
  claimed: "Friday is picking this up…",
  analyzing: "Friday is reading your site — the brief lands in about 20 seconds.",
  drafting: "Brief done. Friday is writing your first ten concepts, about a minute.",
};

export default function OnboardingPage() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation(api.onboarding.submitUrl);
  const request = useQuery(api.onboarding.myLatestRequest);
  const brand = useQuery(api.brands.myBrand);
  const setBrandLanguage = useMutation(api.brands.setLanguage);

  const busy = request && ["pending", "claimed", "analyzing", "drafting"].includes(request.status);
  const previews = request?.previews ?? { ready: 0, total: 0 };
  const stage = stageIndex(request?.status, previews);

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
    <div className={`${styles.wrap} ${styles.wrapRoomy}`}>
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

      {(busy || request?.status === "done") && (
        <div className={styles.progress}>
          <p className={styles.statusLine}>
            <span className={stage === 3 ? styles.liveDot : styles.pulse} />
            {request?.status === "done"
              ? previewLine(previews.ready, previews.total)
              : (STATUS_COPY[request!.status] ?? request!.status)}
          </p>
          <ol className={styles.stageList}>
            {STAGES.map((s, i) => (
              <li key={s.key} className={styles.stage} data-state={i < stage ? "done" : i === stage ? "active" : "todo"}>
                <span className={styles.stageDot} />
                <span className={styles.stageLabel}>{s.label}</span>
                <span className={`mono ${styles.stageEta}`}>
                  {i < stage ? "DONE" : i === stage ? s.eta.toUpperCase() : ""}
                </span>
              </li>
            ))}
          </ol>
          {stage < 3 && (
            <p className={styles.stageNote}>
              You can leave this page — Friday keeps working and everything waits for you in Picks.
            </p>
          )}
        </div>
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
        <Link href="/picks" className="btn btn--accent">
          {previews.ready > 0 ? `Open Picks (${previews.ready} ready) →` : "Open Picks →"}
        </Link>
      )}
    </div>
  );
}
