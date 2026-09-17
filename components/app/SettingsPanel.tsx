"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Show, UserButton, useClerk, useUser } from "@clerk/nextjs";
import { POLICY } from "@/lib/site";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LanguageChip } from "./LanguageChip";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { PresenterPanel } from "./PresenterPanel";
import { BillingSection } from "./BillingSection";
import styles from "./SettingsPanel.module.css";

/* Static shell today: theme + language persist locally; every row marked M2/M4
   wires to Clerk/Stripe/Convex at that milestone. */


export function SettingsPanel() {
  const { user } = useUser();
  const clerk = useClerk();
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const brand = useQuery(api.brands.myBrand);
  const setBrandLanguage = useMutation(api.brands.setLanguage);
  const purgeMine = useMutation(api.account.purgeMine);
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm" | "working" | "error">("idle");

  // Privacy policy › Deletion. Convex data (tokens, briefs, concepts, posts) is
  // purged FIRST so it can never outlive the Clerk identity; then the Clerk user
  // is deleted, which ends the session and drops the user on the landing page.
  const deleteEverything = async () => {
    setDeleteStep("working");
    try {
      await purgeMine({ confirm: "DELETE" });
      await user?.delete();
      window.location.assign("/");
    } catch (err) {
      console.error("delete account failed", err);
      setDeleteStep("error");
    }
  };

  useEffect(() => {
    try {
      const m = localStorage.getItem("mf-mode");
      if (m === "light" || m === "dark") setMode(m);
    } catch {}
  }, []);

  const pick = (m: "dark" | "light") => {
    setMode(m);
    if (m === "light") document.documentElement.dataset.mode = "light";
    else delete document.documentElement.dataset.mode;
    try {
      localStorage.setItem("mf-mode", m);
    } catch {}
  };


  return (
    <div className={styles.scope} data-mode={mode}>
      <div className={styles.wrap}>
        <header className={styles.head}>
          <p className="eyebrow">Settings</p>
          <h1 className={`display ${styles.title}`}>Friday&apos;s back office</h1>
        </header>

        {/* Account */}
        <section className={styles.section} aria-labelledby="s-account">
          <h2 id="s-account" className={`mono ${styles.sectionTitle}`}>ACCOUNT</h2>
          <div className={styles.panel}>
            <Show when="signed-out">
              <div className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>You&apos;re not signed in</p>
                  <p className={styles.rowSub}>Sign in to manage your account — or hire Friday free, no card.</p>
                </div>
                <div className={styles.btnRow}>
                  <Link href="/login" className={styles.ghostBtn}>
                    Log in
                  </Link>
                  <Link href="/signup" className={styles.accentBtn}>
                    Create account
                  </Link>
                </div>
              </div>
            </Show>
            <Show when="signed-in">
              <div className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>Signed in</p>
                  <p className={styles.rowSub}>{user?.primaryEmailAddress?.emailAddress ?? "…"}</p>
                </div>
                <UserButton />
              </div>
              <div className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>Passkey</p>
                  <p className={styles.rowSub}>Sign in with Face ID, Touch ID, or a security key.</p>
                </div>
                <button className={styles.ghostBtn} type="button" onClick={() => clerk.openUserProfile()}>
                  Manage
                </button>
              </div>
              <div className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>Connected sign-ins</p>
                  <p className={styles.rowSub}>Google · email + password</p>
                </div>
                <button className={styles.ghostBtn} type="button" onClick={() => clerk.openUserProfile()}>
                  Manage
                </button>
              </div>
            </Show>
          </div>
        </section>

        {/* Security */}
        <section className={styles.section} aria-labelledby="s-security">
          <h2 id="s-security" className={`mono ${styles.sectionTitle}`}>SECURITY</h2>
          <div className={styles.panel}>
            <div className={styles.row}>
              <div>
                <p className={styles.rowTitle}>Two-factor authentication</p>
                <p className={styles.rowSub}>Authenticator app (TOTP) or a passkey. Required before Friday can connect to your social accounts.</p>
              </div>
              <Show when="signed-in">
                {user?.twoFactorEnabled || (user?.passkeys?.length ?? 0) > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={`mono ${styles.fixed}`}>ENABLED ✓</span>
                    <button className={styles.ghostBtn} type="button" onClick={() => clerk.openUserProfile()}>
                      Manage
                    </button>
                  </div>
                ) : (
                  <button className={styles.ghostBtn} type="button" onClick={() => clerk.openUserProfile()}>
                    Enable 2FA
                  </button>
                )}
              </Show>
            </div>
            <div className={styles.row}>
              <div>
                <p className={styles.rowTitle}>Automatic sign-out</p>
                <p className={styles.rowSub}>
                  You&apos;re signed out after {POLICY.inactivityLogoutMinutes} minutes of inactivity.
                </p>
              </div>
              <span className={`mono ${styles.fixed}`}>ALWAYS ON</span>
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className={styles.section} aria-labelledby="s-appearance">
          <h2 id="s-appearance" className={`mono ${styles.sectionTitle}`}>APPEARANCE</h2>
          <div className={styles.panel}>
            <div className={styles.row}>
              <div>
                <p className={styles.rowTitle}>Mode</p>
                <p className={styles.rowSub}>Broadcast dark is the flagship; light is here when the sun is.</p>
              </div>
              <div className={styles.toggleGroup} role="radiogroup" aria-label="Color mode">
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "dark"}
                  className={`${styles.toggleBtn} ${mode === "dark" ? styles.toggleOn : ""}`}
                  onClick={() => pick("dark")}
                >
                  Dark
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "light"}
                  className={`${styles.toggleBtn} ${mode === "light" ? styles.toggleOn : ""}`}
                  onClick={() => pick("light")}
                >
                  Light
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Plan & billing (M4, live) */}
        <BillingSection />

        {/* Connected accounts (M3) */}
        <section className={styles.section} aria-labelledby="s-connected">
          <h2 id="s-connected" className={`mono ${styles.sectionTitle}`}>CONNECTED ACCOUNTS</h2>
          <Suspense fallback={null}>
            <ConnectedAccounts />
          </Suspense>
        </section>

        {/* Presenter (D2: your brand gets a face — the user's own photo) */}
        <section className={styles.section} aria-labelledby="s-presenter">
          <h2 id="s-presenter" className={`mono ${styles.sectionTitle}`}>YOUR PRESENTER</h2>
          {brand ? <PresenterPanel brandId={brand.id} presenterUrl={brand.presenterUrl} voice={brand.voice} /> : <div className={styles.panel} />}
        </section>

        {/* Language */}
        <section className={styles.section} aria-labelledby="s-language">
          <h2 id="s-language" className={`mono ${styles.sectionTitle}`}>CONTENT LANGUAGE</h2>
          <div className={styles.panel}>
            <div className={styles.row}>
              <div>
                <p className={styles.rowTitle}>Friday writes and speaks in</p>
                <p className={styles.rowSub}>
                  Friday picked it from your site. Hooks, captions, hashtags and the voice follow it —
                  and any pick can also go out in your other markets.
                </p>
              </div>
              {brand ? (
                <LanguageChip
                  language={brand.language}
                  languageStyle={brand.languageStyle}
                  compact
                  onChange={(next) => setBrandLanguage({ brandId: brand.id, ...next })}
                />
              ) : (
                <span className={`mono ${styles.wire}`}>SET IN YOUR BRIEF</span>
              )}
            </div>
          </div>
        </section>

        {/* Data */}
        <section className={styles.section} aria-labelledby="s-data">
          <h2 id="s-data" className={`mono ${styles.sectionTitle}`}>YOUR DATA</h2>
          <div className={`${styles.panel} ${styles.danger}`}>
            <div className={styles.row}>
              <div>
                <p className={styles.rowTitle}>Delete account &amp; data</p>
                <p className={styles.rowSub}>
                  Removes your account, brand briefs, concepts, and disconnects social accounts.
                  Published posts stay on your own social channels. This cannot be undone.
                </p>
              </div>
              <Show when="signed-in">
                {deleteStep === "idle" && (
                  <button className={styles.dangerBtn} type="button" onClick={() => setDeleteStep("confirm")}>
                    Delete…
                  </button>
                )}
                {deleteStep === "confirm" && (
                  <span className={styles.confirmRow}>
                    <button className={styles.dangerBtn} type="button" onClick={deleteEverything}>
                      Yes, delete everything
                    </button>
                    <button className={styles.ghostBtn} type="button" onClick={() => setDeleteStep("idle")}>
                      Keep my account
                    </button>
                  </span>
                )}
                {deleteStep === "working" && <span className={`mono ${styles.fixed}`}>DELETING…</span>}
                {deleteStep === "error" && (
                  <span className={styles.confirmRow}>
                    <span className={`mono ${styles.fixed}`}>SOMETHING FAILED — TRY AGAIN</span>
                    <button className={styles.dangerBtn} type="button" onClick={deleteEverything}>
                      Retry
                    </button>
                  </span>
                )}
              </Show>
              <Show when="signed-out">
                <span className={`mono ${styles.fixed}`}>SIGN IN FIRST</span>
              </Show>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
