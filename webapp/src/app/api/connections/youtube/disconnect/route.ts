import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/service";
import { decryptToken } from "@/lib/server/crypto";

function hexToUtf8Base64(hexWire: string): string {
  const hex = hexWire.startsWith("\\x") ? hexWire.slice(2) : hexWire;
  return Buffer.from(hex, "hex").toString("base64");
}

/** Revokes our access at Google, then removes the stored token. */
export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: rows, error } = await svc
    .from("google_oauth_tokens")
    .select("id, refresh_token_ciphertext")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const row of rows ?? []) {
    try {
      const refreshToken = await decryptToken(hexToUtf8Base64(row.refresh_token_ciphertext as unknown as string));
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // Revocation is best-effort: an already-invalid token can't be revoked twice.
    }
    await svc.from("google_oauth_tokens").delete().eq("id", row.id);
  }

  return NextResponse.json({ ok: true });
}
