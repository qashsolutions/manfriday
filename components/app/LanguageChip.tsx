"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { languageMeta, searchLanguages, styleOptions, type LanguageStyle } from "@/lib/languages";
import styles from "./LanguageChip.module.css";

type Props = {
  language: string;
  languageStyle?: LanguageStyle | null;
  /** Show the FRIDAY'S PICK badge (the value came from the brief, untouched). */
  inferred?: boolean;
  onChange: (next: { language: string; languageStyle?: LanguageStyle }) => unknown;
  compact?: boolean;
};

/** Language UX §1 (docs/language-ux.md): the chip IS the control. Click or
 *  Enter opens a command-menu combobox under it — type-ahead in any script,
 *  arrow keys, Enter, Esc. Never a <select>. Indic languages get a
 *  "how it sounds" row beside the chip. */
export function LanguageChip({ language, languageStyle, inferred, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const meta = languageMeta(language);
  const results = useMemo(() => searchLanguages(query), [query]);
  const options = styleOptions(language);
  const currentStyle: LanguageStyle | null = options.length ? (languageStyle ?? "code-mixed") : null;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  const pick = (code: string) => {
    setOpen(false);
    if (code === language) return;
    const nextStyle = styleOptions(code).length ? ("code-mixed" as const) : undefined;
    void onChange({ language: code, languageStyle: nextStyle });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) pick(results[active].code);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`${styles.root} ${compact ? styles.compact : ""}`}>
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.chip} ${open ? styles.chipOpen : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.native} lang={language}>{meta.native}</span>
          {meta.native !== meta.name && <span className={styles.english}>{meta.name}</span>}
          {inferred && <span className={`mono ${styles.badge}`}>FRIDAY&apos;S PICK</span>}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {options.length > 0 && (
          <div className={styles.segment} role="radiogroup" aria-label="How it sounds">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={currentStyle === o.value}
                title={o.hint}
                className={`${styles.segBtn} ${currentStyle === o.value ? styles.segOn : ""}`}
                onClick={() => void onChange({ language, languageStyle: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className={styles.pop} role="dialog" aria-label="Choose a language">
          <div className={styles.search}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              className={styles.input}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder="Type in any script…"
              aria-label="Search languages"
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${results[active].code}` : undefined}
              role="combobox"
              aria-expanded="true"
              autoComplete="off"
            />
            <span className={`mono ${styles.kbd}`}>ESC</span>
          </div>
          <ul id={listId} role="listbox" className={styles.list}>
            {results.length === 0 && <li className={styles.empty}>Not in the launch set yet.</li>}
            {results.map((l, i) => (
              <li
                key={l.code}
                id={`${listId}-${l.code}`}
                role="option"
                aria-selected={l.code === language}
                className={`${styles.item} ${i === active ? styles.itemActive : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(l.code)}
              >
                <span className={styles.itemNative} lang={l.code}>{l.native}</span>
                <span className={styles.itemName}>{l.name}</span>
                {l.code === language && <span className={`mono ${styles.itemNow}`}>NOW</span>}
                {i === active && l.code !== language && <span className={`mono ${styles.itemNow}`}>↵</span>}
              </li>
            ))}
          </ul>
          <div className={`mono ${styles.foot}`}>
            <span>↑↓ MOVE · ↵ PICK · ANY SCRIPT</span>
            <span>14 LANGUAGES · EVERY PLAN</span>
          </div>
        </div>
      )}
    </div>
  );
}
