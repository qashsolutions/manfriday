"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./SettingsPanel.module.css";

const MAX_BYTES = 10 * 1024 * 1024;

/** The user's own photo becomes the presenter in avatar videos: Friday animates
 *  it for the hook (first seconds), then cuts to the product. Consent is an
 *  explicit attestation; the platforms' AI-generated labels are always set. */
export function PresenterPanel({ brandId, presenterUrl }: { brandId: Id<"brands">; presenterUrl: string | null }) {
  const getUploadUrl = useMutation(api.brands.presenterUploadUrl);
  const setPresenter = useMutation(api.brands.setPresenter);
  const removePresenter = useMutation(api.brands.removePresenter);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!file || !consent) return;
    setBusy(true);
    setError(null);
    try {
      const url = await getUploadUrl({});
      const resp = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const { storageId } = (await resp.json()) as { storageId: Id<"_storage"> };
      await setPresenter({ brandId, storageId, consent: true });
      setFile(null);
      setConsent(false);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      console.error(err);
      setError("Upload didn't complete — try a smaller JPG or PNG.");
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: File | null) => {
    setError(null);
    if (f && f.size > MAX_BYTES) {
      setError("Please use a photo under 10 MB.");
      return;
    }
    if (f && !/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setError("JPG, PNG or WebP only.");
      return;
    }
    setFile(f);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <div>
          <p className={styles.rowTitle}>Your face on camera</p>
          <p className={styles.rowSub}>
            {presenterUrl
              ? "Friday animates this photo to speak the hook of avatar videos, then cuts to your product. Each avatar video is labelled AI-generated on TikTok and YouTube, as their rules require."
              : "Add one clear, front-facing photo. Friday animates it to speak the first seconds of avatar videos, then cuts to your product. Without a photo, Friday makes slideshows and hook videos only."}
          </p>
        </div>
        {presenterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={presenterUrl} alt="Your presenter photo" width={72} height={96} style={{ objectFit: "cover", borderRadius: 12, flexShrink: 0 }} />
        )}
      </div>
      <div className={styles.row} style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.45 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
          <span>
            This is a photo of me, or of someone who has given me written permission to use their likeness in my
            videos. I understand Friday will generate videos of this person speaking, that those videos will carry
            the platforms&apos; AI-generated label, and that I can remove the photo at any time.
          </span>
        </label>
        {error && <p className={styles.rowSub} style={{ color: "var(--accent)", margin: 0 }}>{error}</p>}
        <span className={styles.confirmRow} style={{ justifyContent: "flex-start" }}>
          <button className={styles.ghostBtn} type="button" onClick={upload} disabled={!file || !consent || busy}>
            {busy ? "Uploading…" : presenterUrl ? "Replace photo" : "Use this photo"}
          </button>
          {presenterUrl && (
            <button className={styles.dangerBtn} type="button" onClick={() => removePresenter({ brandId })} disabled={busy}>
              Remove
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
