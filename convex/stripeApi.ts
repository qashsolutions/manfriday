/** Minimal Stripe REST client for the default Convex runtime (fetch + Web Crypto).
 *  No SDK: the handful of calls billing makes are plain form posts, and webhook
 *  signatures are one HMAC. Keys come from Convex env only and are never logged. */

type Params = Record<string, unknown>;

/** Stripe's bracketed form encoding: a[b]=1, items[0][price]=x. */
export function formEncode(params: Params, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") parts.push(formEncode(item as Params, `${name}[${i}]`));
        else parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      parts.push(formEncode(value as Params, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

export class StripeError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(`STRIPE_${status}: ${message}`);
  }
}

export async function stripeCall<T = any>(secretKey: string | undefined, method: "GET" | "POST" | "DELETE", path: string, params: Params = {}): Promise<T> {
  if (!secretKey) throw new Error("STRIPE_NOT_CONFIGURED: set STRIPE_SECRET_KEY in the Convex dashboard");
  const encoded = formEncode(params);
  const url = `https://api.stripe.com/v1${path}${method === "GET" && encoded ? `?${encoded}` : ""}`;
  const resp = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : encoded,
  });
  const json = (await resp.json()) as any;
  if (!resp.ok) throw new StripeError(resp.status, json?.error?.message ?? "request failed", json?.error?.code);
  return json as T;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a Stripe-Signature header (t=…,v1=…) against the raw body. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowMs = Date.now(), toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const pairs = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(pairs.find(([k]) => k === "t")?.[1]);
  const signatures = pairs.filter(([k]) => k === "v1").map(([, s]) => s);
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return signatures.some((s) => safeEqual(s, expected));
}

/** Build a header the way Stripe does — used by tests. */
export async function signForTest(payload: string, secret: string, tSec: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${tSec}.${payload}`)));
  return `t=${tSec},v1=${sig}`;
}
