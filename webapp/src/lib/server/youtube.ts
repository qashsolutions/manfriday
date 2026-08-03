import { decryptToken } from "./crypto";

/** Server-side YouTube Data API access using the user's stored refresh token. */

function hexToUtf8Base64(hexWire: string): string {
  const hex = hexWire.startsWith("\\x") ? hexWire.slice(2) : hexWire;
  return Buffer.from(hex, "hex").toString("base64");
}

export async function accessTokenFromRow(refreshTokenCiphertext: string): Promise<string> {
  const refreshToken = await decryptToken(hexToUtf8Base64(refreshTokenCiphertext));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error("Couldn't refresh YouTube access — reconnect the channel in Settings.");
  return j.access_token as string;
}

export async function yt(path: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`YouTube API error on ${path.split("?")[0]}`);
  return j as Record<string, unknown>;
}

/** ISO-8601 duration (PT#H#M#S) → seconds. */
export function isoDurationToSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
