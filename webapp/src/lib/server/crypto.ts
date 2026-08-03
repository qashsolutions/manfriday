import { webcrypto } from "node:crypto";

/** AES-256-GCM for OAuth refresh tokens. Key: TOKEN_ENCRYPTION_KEY, base64, 32 bytes.
    Wire format (base64): 12-byte IV || ciphertext+tag. The DB only ever sees ciphertext. */

async function key() {
  const b64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!b64) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)");
  return webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plaintext: string): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    new TextEncoder().encode(plaintext)
  );
  return Buffer.concat([Buffer.from(iv), Buffer.from(ct)]).toString("base64");
}

export async function decryptToken(wire: string): Promise<string> {
  const buf = Buffer.from(wire, "base64");
  const iv = buf.subarray(0, 12);
  const ct = buf.subarray(12);
  const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), ct);
  return new TextDecoder().decode(pt);
}
