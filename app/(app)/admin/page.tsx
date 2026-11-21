"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GUEST } from "@/lib/site";
import styles from "../app.module.css";

type Invitation = { id: string; email: string; status: string; createdAt: number };

const when = (ms: number) => new Date(ms).toLocaleString();
const dateOnly = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
/** Now, to the minute, so the guest query result can be cached between renders. */
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Operator screen for the pilot: invite testers, see who is using it, read
 *  their feedback, and see what broke. Only visible to team accounts. */
export default function AdminPage() {
  const isAdmin = useQuery(api.admin.amIAdmin);
  const view = useQuery(api.admin.operatorView);
  const [now, setNow] = useState(minuteNow);
  useEffect(() => {
    const id = setInterval(() => setNow(minuteNow()), 60_000);
    return () => clearInterval(id);
  }, []);
  const guests = useQuery(api.guests.summary, { now });
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [notify, setNotify] = useState(true);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const r = await fetch("/api/invites");
    if (r.ok) setInvites((await r.json()).invitations);
  };
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin]);

  if (isAdmin === undefined) return null;
  if (!isAdmin) {
    return (
      <div className={styles.wrap}>
        <h1 className={`display ${styles.title}`}>Not for you</h1>
        <p className={styles.sub}>This screen is for the people running the pilot.</p>
      </div>
    );
  }

  const invite = async () => {
    setBusy(true);
    setError(null);
    setLink(null);
    const r = await fetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, notify }) });
    const data = await r.json();
    if (!r.ok) setError(data.error ?? "Couldn't send that invite.");
    else {
      if (data.url) setLink({ email: data.email, url: data.url });
      setEmail("");
      await load();
    }
    setBusy(false);
  };

  const revoke = async (id: string) => {
    await fetch(`/api/invites?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className={styles.wrap} style={{ maxWidth: 860 }}>
      <p className="eyebrow">Pilot</p>
      <h1 className={`display ${styles.title}`}>Operator</h1>

      <span className={styles.sectionTitle}>
        INVITE A GUEST{guests ? ` · ${guests.used} OF ${guests.cap} SLOTS USED` : ""}
      </span>
      <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 520, flexWrap: "wrap" }}>
        <input
          className={styles.urlInput}
          style={{ flex: 1, minWidth: 220 }}
          placeholder="them@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email address to invite"
        />
        <button
          type="button"
          className="btn btn--accent"
          disabled={busy || !email.includes("@") || (guests ? guests.used >= guests.cap : false)}
          onClick={() => void invite()}
        >
          {busy ? "Creating…" : notify ? "Send invite" : "Create link"}
        </button>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, color: "var(--dim)" }}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Email the invite now (untick to get the link and send it yourself)
      </label>
      {error && <p className={styles.error}>{error}</p>}
      {link && (
        <div className="panel" style={{ padding: "12px 16px", width: "100%", maxWidth: 640 }}>
          <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--faint)" }}>
            NOT EMAILED · LINK FOR {link.email.toUpperCase()} · WORKS FOR {GUEST.inviteDays} DAYS
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, wordBreak: "break-all" }}>{link.url}</p>
        </div>
      )}
      <p className={styles.sub} style={{ fontSize: 13 }}>
        Every invite is a guest: {GUEST.videos} videos, and the account — data and sign-in — is
        deleted {GUEST.days} days after their first sign-in. At most {GUEST.cap} guests at once;
        revoking an unused invite frees its slot, and the link stops working after{" "}
        {GUEST.inviteDays} days. Sign-up must stay invite-only in the Clerk dashboard.
      </p>

      {guests && (guests.guests.length > 0 || guests.invited.length > 0) && (
        <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 6 }}>
          {guests.guests.map((g) => (
            <div key={g.email} className="panel" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px" }}>
              <span style={{ fontSize: 14 }}>{g.email}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--mint)" }}>
                GUEST · {g.used}/{g.grant ?? GUEST.videos} USED · DELETED {dateOnly(g.endsAt).toUpperCase()}
              </span>
            </div>
          ))}
          {guests.invited.map((g) => (
            <div key={g.email} className="panel" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px" }}>
              <span style={{ fontSize: 14 }}>{g.email}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
                INVITED · LINK LAPSES {dateOnly(g.inviteExpiresAt).toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}

      {invites && invites.length > 0 && (
        <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 6 }}>
          {invites.map((i) => (
            <div key={i.id} className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 16px" }}>
              <span style={{ fontSize: 14 }}>{i.email}</span>
              <span className="mono" style={{ fontSize: 11, color: i.status === "accepted" ? "var(--mint)" : "var(--faint)" }}>
                {i.status.toUpperCase()} · {when(i.createdAt)}
              </span>
              {i.status === "pending" && (
                <button type="button" className={styles.skipBtn} style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => void revoke(i.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {view && (
        <>
          <span className={styles.sectionTitle}>TESTERS</span>
          <div style={{ width: "100%", overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--faint)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>EMAIL</th><th>PLAN</th><th>ALLOWANCE</th><th>USED</th><th>VIDEOS</th><th>POSTS</th><th>JOINED</th>
                </tr>
              </thead>
              <tbody>
                {view.testers.map((t) => (
                  <tr key={t.email} style={{ borderTop: "1px solid var(--edge)" }}>
                    <td style={{ padding: "6px 8px" }}>{t.email}</td>
                    <td>{t.team ? "TEAM" : t.guestEndsAt ? `GUEST → ${dateOnly(t.guestEndsAt).toUpperCase()}` : t.plan.toUpperCase()}</td>
                    <td>{t.team ? "∞" : (t.grant ?? 3)}</td>
                    <td>{t.used}</td>
                    <td>{t.videos}</td>
                    <td>{t.posts}</td>
                    <td>{new Date(t.joined).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <span className={styles.sectionTitle}>FEEDBACK</span>
          {view.feedback.length === 0 ? (
            <div className={styles.stub}>Nothing yet.</div>
          ) : (
            view.feedback.map((f, i) => (
              <div key={i} className="panel" style={{ padding: "12px 16px", width: "100%", maxWidth: 640 }}>
                <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--faint)" }}>{f.from} · {f.page} · {when(f.at)}</p>
                <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>{f.message}</p>
                {f.details && (
                  <p className="mono" style={{ margin: "8px 0 0", fontSize: 11, color: "var(--faint)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {f.details}
                  </p>
                )}
              </div>
            ))
          )}

          <span className={styles.sectionTitle}>WHAT BROKE</span>
          {view.alerts.length === 0 ? (
            <div className={styles.stub}>Nothing has failed.</div>
          ) : (
            view.alerts.map((a, i) => (
              <div key={i} className="panel" style={{ padding: "12px 16px", width: "100%", maxWidth: 640 }}>
                <p className="mono" style={{ margin: 0, fontSize: 11, color: a.kind === "feedback" ? "var(--faint)" : "var(--accent)" }}>
                  {a.kind.toUpperCase()} · {a.who ?? "—"} · {when(a.at)} · {a.emailed ? "EMAILED" : "RECORDED"}
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 13.5, whiteSpace: "pre-wrap" }}>{a.message}</p>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
