"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import styles from "./SettingsPanel.module.css";

/** Auth policy v2: passkey OR 2FA required before any social account connects. */
export function ConnectedAccounts() {
  const { user } = useUser();
  const accounts = useQuery(api.oauth.myAccounts);
  const startTikTok = useMutation(api.oauth.startTikTok);
  const disconnect = useMutation(api.oauth.disconnect);
  const params = useSearchParams();
  const connectResult = params.get("connect");

  const mfaSatisfied =
    !!user && (user.twoFactorEnabled || (user.passkeys?.length ?? 0) > 0);

  const tiktok = accounts?.find((a) => a.platform === "tiktok" && a.status === "connected");

  const onConnect = async () => {
    const { url } = await startTikTok();
    window.location.href = url;
  };

  return (
    <div className={styles.panel}>
      {connectResult === "tiktok_ok" && (
        <div className={styles.row}>
          <p className={styles.rowSub} style={{ color: "var(--mint)" }}>
            TikTok connected — Friday can post here now.
          </p>
        </div>
      )}
      {(connectResult === "tiktok_failed" || connectResult === "tiktok_denied") && (
        <div className={styles.row}>
          <p className={styles.rowSub} style={{ color: "var(--accent)" }}>
            TikTok connection didn&apos;t complete — try again.
          </p>
        </div>
      )}

      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>TikTok</p>
          <p className={styles.rowSub}>
            {tiktok
              ? `Connected as ${tiktok.handle}. Posts publish to this account.`
              : "Friday can't post here yet."}
          </p>
        </div>
        {tiktok ? (
          <button className={styles.dangerBtn} type="button" onClick={() => disconnect({ accountId: tiktok.id })}>
            Disconnect
          </button>
        ) : mfaSatisfied ? (
          <button className={styles.ghostBtn} type="button" onClick={onConnect}>
            Connect TikTok
          </button>
        ) : (
          <span className={`mono ${styles.fixed}`} style={{ color: "var(--amber)" }}>
            ADD A PASSKEY OR 2FA FIRST
          </span>
        )}
      </div>

      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>YouTube Shorts</p>
          <p className={styles.rowSub}>
            Arrives when the Google Cloud credentials land — same rules, same gate.
          </p>
        </div>
        <span className={`mono ${styles.fixed}`}>SOON</span>
      </div>

      {!mfaSatisfied && (
        <div className={styles.row}>
          <p className={styles.rowSub}>
            Posting permissions are the most sensitive thing in your account, so Friday requires
            a passkey or two-factor authentication before connecting one — set either up in the
            Security section above.
          </p>
        </div>
      )}
    </div>
  );
}
