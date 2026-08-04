"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type ThemeChoice = "light" | "dark" | "system";
type Factor = { id: string; friendly_name?: string | null; status: string };
type YtStatus =
  | { configured: false }
  | { configured: true; connected: false }
  | { configured: true; connected: true; channelTitle: string | null; connectedAt: string | null };

async function authedFetch(path: string, init?: RequestInit) {
  const supabase = supabaseBrowser();
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
  });
}

export default function SettingsPage() {
  const supabase = supabaseBrowser();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [yt, setYt] = useState<YtStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const loadAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setEmail(user.email ?? "");
    setProviders((user.identities ?? []).map((i) => i.provider));
    const prof = await supabase.from("profiles").select("paused_at").eq("id", user.id).maybeSingle();
    setPaused(Boolean(prof.data?.paused_at));
    const { data: f } = await supabase.auth.mfa.listFactors();
    setFactors((f?.totp ?? []).map((t) => ({ id: t.id, friendly_name: t.friendly_name, status: t.status })));
    try {
      const r = await authedFetch("/api/connections/status");
      setYt(r.ok ? await r.json() : { configured: false });
    } catch {
      setYt({ configured: false });
    }
  }, [supabase]);

  useEffect(() => {
    try {
      const t = localStorage.getItem("mf-theme");
      setTheme(t === "dark" || t === "light" ? t : "system");
    } catch {}
    loadAll();
  }, [loadAll]);

  function applyTheme(t: ThemeChoice) {
    setTheme(t);
    const root = document.documentElement;
    if (t === "system") {
      root.removeAttribute("data-theme");
      try { localStorage.removeItem("mf-theme"); } catch {}
    } else {
      root.setAttribute("data-theme", t);
      try { localStorage.setItem("mf-theme", t); } catch {}
    }
  }

  async function startEnroll() {
    setErr(null); setBusy("mfa");
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setErr(null); setBusy("mfa");
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: enroll.id });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: enroll.id, challengeId: challenge.id, code: enrollCode.trim(),
      });
      if (vErr) throw vErr;
      setEnroll(null); setEnrollCode("");
      setMsg("Authenticator app added. You'll be asked for a code at sign-in from now on.");
      await loadAll();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "That code didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function removeFactor(id: string) {
    setErr(null); setBusy("mfa");
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setMsg("Authenticator app removed.");
    await loadAll();
  }

  async function togglePause() {
    setErr(null); setBusy("pause");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ paused_at: paused ? null : new Date().toISOString() })
      .eq("id", user.id);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setPaused(!paused);
    setMsg(!paused
      ? "Account paused. The team stops all work until you resume — your data stays put."
      : "Welcome back — the team resumes on the next cycle.");
  }

  async function downloadData() {
    setErr(null); setBusy("export");
    const { data, error } = await supabase.rpc("export_my_data");
    setBusy(null);
    if (error) { setErr(error.message); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `manfriday-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function connectYouTube() {
    setErr(null); setBusy("yt");
    try {
      const r = await authedFetch("/api/connections/youtube/start");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Connection isn't configured yet.");
      window.location.href = j.url;
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Couldn't start the connection.");
      setBusy(null);
    }
  }

  async function disconnectYouTube() {
    setErr(null); setBusy("yt");
    try {
      const r = await authedFetch("/api/connections/youtube/disconnect", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't disconnect.");
      setMsg("YouTube disconnected — our access is revoked at Google, effective immediately.");
      await loadAll();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Couldn't disconnect.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setErr(null); setBusy("delete");
    try {
      const r = await authedFetch("/api/account/delete", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't delete the account.");
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Couldn't delete the account.");
      setBusy(null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <>
      <div className="pagehead"><h1>Settings</h1></div>
      {msg && <div className="ok-note">{msg}</div>}
      {err && <div className="err">{err}</div>}

      <div className="setsect card">
        <h2>Account</h2>
        <div className="setrow">
          <div className="grow">
            <b>Signed in as</b>
            <p className="num">{email}</p>
          </div>
          <div className="end">
            {providers.map((p) => (
              <span key={p} className="pill mut">{p === "google" ? "Google" : p === "email" ? "Email code" : p}</span>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>

      <div className="setsect card">
        <h2>Sign-in &amp; security</h2>
        <div className="setrow">
          <div className="grow">
            <b>Authenticator app (two-step sign-in)</b>
            <p>Adds a 6-digit code from an app like Google Authenticator or 1Password every time you sign in.</p>
          </div>
          <div className="end">
            {factors.filter((f) => f.status === "verified").length > 0 ? (
              <>
                <span className="pill good">on</span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy === "mfa"}
                  onClick={() => removeFactor(factors.filter((f) => f.status === "verified")[0].id)}
                >
                  Turn off
                </button>
              </>
            ) : (
              <button className="btn btn-ghost btn-sm" disabled={busy === "mfa"} onClick={startEnroll}>
                Set up
              </button>
            )}
          </div>
        </div>
        {enroll && (
          <div className="qrbox">
            <div className="qr">
              {/* Supabase returns the QR as an SVG data URI */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt="Scan this QR code with your authenticator app" />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <b style={{ fontSize: 13 }}>1. Scan with your authenticator app</b>
              <p style={{ color: "var(--ink2)", fontSize: 12.5, margin: "4px 0 10px" }}>
                Can&apos;t scan? Enter this key instead: <span className="num" style={{ userSelect: "all" }}>{enroll.secret}</span>
              </p>
              <form onSubmit={confirmEnroll} style={{ display: "flex", gap: 8 }}>
                <input
                  className="input code" style={{ width: 140 }} maxLength={6} inputMode="numeric"
                  placeholder="••••••" value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)}
                />
                <button className="btn btn-acc" disabled={busy === "mfa" || enrollCode.trim().length < 6}>
                  Confirm
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setEnroll(null)}>Cancel</button>
              </form>
            </div>
          </div>
        )}
      </div>

      <div className="setsect card">
        <h2>Appearance</h2>
        <div className="setrow">
          <div className="grow">
            <b>Theme</b>
            <p>Light, dark, or follow your device.</p>
          </div>
          <div className="end">
            <div className="seg" role="group" aria-label="Theme">
              {(["light", "dark", "system"] as ThemeChoice[]).map((t) => (
                <button key={t} className={theme === t ? "on" : ""} onClick={() => applyTheme(t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="setsect card" id="connections">
        <h2>Connections</h2>
        <div className="setrow">
          <div className="grow">
            <b>YouTube</b>
            {yt === null ? (
              <p>Checking…</p>
            ) : !yt.configured ? (
              <p>Connection service isn&apos;t configured on this deployment yet.</p>
            ) : yt.connected ? (
              <p>
                Connected{yt.channelTitle ? <> — <b style={{ display: "inline" }}>{yt.channelTitle}</b></> : null}. Read-only:
                we can look, we can&apos;t touch. Disconnecting revokes our access at Google immediately.
              </p>
            ) : (
              <p>Not connected. Your team needs read-only access to your stats and comments to work.</p>
            )}
          </div>
          <div className="end">
            {yt?.configured && yt.connected ? (
              <button className="btn btn-ghost btn-sm" disabled={busy === "yt"} onClick={disconnectYouTube}>
                Disconnect
              </button>
            ) : (
              <button className="btn btn-acc btn-sm" disabled={busy === "yt" || !yt?.configured} onClick={connectYouTube}>
                Connect
              </button>
            )}
          </div>
        </div>
        <div className="setrow">
          <div className="grow"><b>Notion</b><p>Send reports and your video catalog to your own Notion.</p></div>
          <div className="end"><span className="pill mut">coming soon</span></div>
        </div>
        <div className="setrow">
          <div className="grow"><b>Google Drive</b><p>Export any report as a file in your Drive.</p></div>
          <div className="end"><span className="pill mut">coming soon</span></div>
        </div>
      </div>

      <div className="setsect card">
        <h2>Billing</h2>
        <div className="setrow">
          <div className="grow">
            <b>One-week trial</b>
            <p>Your first week is on us — no card on file. When your trial ends you&apos;ll choose a plan here; nothing is ever charged without you seeing it first.</p>
          </div>
          <div className="end"><span className="pill acc">trial</span></div>
        </div>
      </div>

      <div className="setsect card">
        <h2>Your data</h2>
        <div className="setrow">
          <div className="grow">
            <b>Download everything</b>
            <p>One file with everything we know about your channel — your numbers, reports, idea list, and the full ledger.</p>
          </div>
          <div className="end">
            <button className="btn btn-ghost btn-sm" disabled={busy === "export"} onClick={downloadData}>
              Download my data
            </button>
          </div>
        </div>
        <div className="setrow">
          <div className="grow">
            <b>{paused ? "Resume your account" : "Pause your account"}</b>
            <p>
              {paused
                ? "Paused right now — the team isn't running any analysis and nothing is billed. Your data is untouched."
                : "The team stops all work and billing pauses. Your data stays exactly as it is until you come back."}
            </p>
          </div>
          <div className="end">
            <button className="btn btn-ghost btn-sm" disabled={busy === "pause"} onClick={togglePause}>
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
        <div className="setrow">
          <div className="grow">
            <b>Delete my account</b>
            <p>Everything is erased right away — your data, reports, all of it. Our access at Google is revoked first. No hidden copies, no waiting period.</p>
          </div>
          <div className="end">
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete everything</button>
          </div>
        </div>
      </div>

      <div className="setsect card">
        <h2>About</h2>
        <div className="setrow">
          <div className="grow">
            <b>The fine print, in plain English</b>
            <p>
              <a href="/terms" target="_blank" style={{ color: "var(--acc)" }}>Terms of service</a>
              {" · "}
              <a href="/privacy" target="_blank" style={{ color: "var(--acc)" }}>Privacy policy</a>
              {" · "}
              <a href="mailto:hello@manfriday.app" style={{ color: "var(--acc)" }}>hello@manfriday.app</a>
            </p>
            <p style={{ marginTop: 6 }}>
              manfriday uses YouTube API Services — the{" "}
              <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>YouTube Terms of Service</a>{" "}
              and{" "}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>Google Privacy Policy</a>{" "}
              also apply to your connected channel. Revoke access any time in your{" "}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>Google security settings</a>.
            </p>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="modalback" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>Delete your account?</h3>
            <p>
              This erases everything immediately and revokes our YouTube access at Google first.
              It cannot be undone. Type <b style={{ display: "inline" }}>DELETE</b> to confirm.
            </p>
            <input
              className="input" value={deleteText} onChange={(e) => setDeleteText(e.target.value)}
              placeholder="DELETE" autoFocus
            />
            <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => { setConfirmDelete(false); setDeleteText(""); }}>
                Keep my account
              </button>
              <button
                className="btn btn-danger"
                disabled={deleteText !== "DELETE" || busy === "delete"}
                onClick={deleteAccount}
              >
                {busy === "delete" ? "Deleting…" : "Delete everything"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
