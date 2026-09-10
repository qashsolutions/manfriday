"use client";

import { useEffect, useState } from "react";
import { languageMeta, searchLanguages, styleLabel, suggestMarkets, type LanguageMeta, type LanguageStyle } from "@/lib/languages";
import styles from "./AlsoInSheet.module.css";

type Props = {
  primary: string;
  primaryStyle?: LanguageStyle | null;
  markets?: readonly string[] | null;
  hook: string;
  onAdd: (language: string) => Promise<void> | void;
  onClose: () => void;
};

/** Language UX §2: after a keep, offer the same pick in the brand's other
 *  markets. One tap = one more video, and the sheet says so. */
export function AlsoInSheet({ primary, primaryStyle, markets, hook, onAdd, onClose }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const suggestions = suggestMarkets(primary, markets);
  const primaryMeta = languageMeta(primary);
  const results: LanguageMeta[] = searching ? searchLanguages(query).filter((l) => l.code !== primary).slice(0, 6) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = async () => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      await onAdd(picked);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const pickedMeta = picked ? languageMeta(picked) : null;

  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="alsoin-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.grip} aria-hidden="true" />
        <div className={styles.head}>
          <h2 id="alsoin-title" className={styles.title}>Post this one in another market too?</h2>
          <p className={styles.sub}>
            Same pick, rewritten and voiced by Friday. Each one counts as a video.
          </p>
          <p className={`mono ${styles.hook}`}>
            <span lang={primary}>{primaryMeta.native}</span>
            {styleLabel(primary, primaryStyle) ? ` · ${styleLabel(primary, primaryStyle)}` : ""} · “{hook.slice(0, 60)}
            {hook.length > 60 ? "…" : ""}”
          </p>
        </div>

        <div className={styles.tiles}>
          {suggestions.map((l) => (
            <button
              key={l.code}
              type="button"
              className={`${styles.tile} ${picked === l.code ? styles.tileOn : ""}`}
              aria-pressed={picked === l.code}
              onClick={() => setPicked(picked === l.code ? null : l.code)}
            >
              <span className={styles.tileNative} lang={l.code}>{l.native}</span>
              <span className={`mono ${styles.tileSub}`}>{picked === l.code ? "+1 VIDEO ✓" : l.name.toUpperCase()}</span>
            </button>
          ))}
        </div>

        <div className={styles.other}>
          {searching ? (
            <div className={styles.searchRow}>
              <input
                className={styles.input}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type in any script…"
                aria-label="Search languages"
              />
              <div className={styles.results}>
                {results.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    className={`${styles.result} ${picked === l.code ? styles.resultOn : ""}`}
                    onClick={() => {
                      setPicked(l.code);
                      setSearching(false);
                    }}
                  >
                    <span lang={l.code}>{l.native}</span>
                    <span className={styles.resultName}>{l.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button type="button" className={styles.otherBtn} onClick={() => setSearching(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              Other language
            </button>
          )}
          <span className={`mono ${styles.hint}`}>FRIDAY SUGGESTS FROM YOUR AUDIENCE</span>
        </div>

        <div className={styles.actions}>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Just {primaryMeta.name}
          </button>
          <button type="button" className="btn btn--accent" onClick={confirm} disabled={!picked || busy}>
            {pickedMeta ? `Add ${pickedMeta.name} →` : "Pick a market"}
          </button>
        </div>
      </div>
    </div>
  );
}
