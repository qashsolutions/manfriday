"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "start" | "code" | "mfa";

function GoogleMark() {
  return (
    <span
      aria-hidden
      style={{
        width: 17, height: 17, borderRadius: "50%", display: "inline-block",
        background: "conic-gradient(#4285F4 0 25%, #34A853 0 50%, #FBBC05 0 75%, #EA4335 0)",
      }}
    />
  );
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // If already signed in: either MFA is pending or we can go to the Desk.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setStep("mfa");
      } else {
        router.replace("/settings");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signInGoogle() {
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) { setError(error.message); setBusy(false); }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setNote(`We emailed a 6-digit code to ${email.trim()}.`);
    setStep("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      setNote(null);
      setStep("mfa");
    } else {
      router.replace("/settings");
    }
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
      if (fErr) throw fErr;
      const totp = factors?.totp?.[0];
      if (!totp) throw new Error("No authenticator app is set up on this account.");
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code: mfaCode.trim(),
      });
      if (vErr) throw vErr;
      router.replace("/settings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authpage">
      <div className="authcard">
        <div className="tick" />
        <h1>
          {step === "mfa" ? "One more step" : "Let's get your team started"}
        </h1>

        {step === "start" && (
          <>
            <p>Sign in with the Google account you use for YouTube, or with your email. This step only tells us who you are — it doesn't touch your channel.</p>
            {error && <div className="err">{error}</div>}
            <button className="btn btn-ghost btn-lg" style={{ width: "100%" }} onClick={signInGoogle} disabled={busy}>
              <GoogleMark /> Continue with Google
            </button>
            <div className="hr">or use your email</div>
            <form onSubmit={sendCode}>
              <label className="field">
                <span>Email address</span>
                <input
                  className="input" type="email" required autoComplete="email"
                  placeholder="you@example.com" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button className="btn btn-acc btn-lg" style={{ width: "100%" }} disabled={busy || !email.trim()}>
                Email me a sign-in code
              </button>
            </form>
            <div className="fine">Free to start · no card · nothing is ever posted to your channel</div>
          </>
        )}

        {step === "code" && (
          <>
            <p>Enter the 6-digit code from your email. It expires in about an hour.</p>
            {note && <div className="ok-note">{note}</div>}
            {error && <div className="err">{error}</div>}
            <form onSubmit={verifyCode}>
              <label className="field">
                <span>Sign-in code</span>
                <input
                  className="input code" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  required value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="••••••"
                />
              </label>
              <button className="btn btn-acc btn-lg" style={{ width: "100%" }} disabled={busy || code.trim().length < 6}>
                Sign in
              </button>
            </form>
            <div className="fine">
              Wrong email?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setStep("start"); setCode(""); setNote(null); setError(null); }}>
                Start over
              </a>
            </div>
          </>
        )}

        {step === "mfa" && (
          <>
            <p>This account is protected with an authenticator app. Enter the current 6-digit code.</p>
            {error && <div className="err">{error}</div>}
            <form onSubmit={verifyMfa}>
              <label className="field">
                <span>Authenticator code</span>
                <input
                  className="input code" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="••••••"
                />
              </label>
              <button className="btn btn-acc btn-lg" style={{ width: "100%" }} disabled={busy || mfaCode.trim().length < 6}>
                Verify
              </button>
            </form>
            <div className="fine">
              <a href="#" onClick={async (e) => { e.preventDefault(); await supabase.auth.signOut(); setStep("start"); setError(null); }}>
                Use a different account
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
