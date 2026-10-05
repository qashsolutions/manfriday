/** Clerk's middleware sends a signed-out visitor to /login with the page they
 *  wanted in `redirect_url`. Clerk honours that on its own for an email sign-in,
 *  but an OAuth round trip can drop the query string, which lands the user on
 *  the fallback instead of the page they asked for. Passing it back as
 *  forceRedirectUrl makes it survive.
 *
 *  Never trust the value: an attacker-supplied absolute URL here is an open
 *  redirect. Only a same-origin path ever comes back out. */
const ALLOWED_HOSTS = new Set(
  [process.env.NEXT_PUBLIC_APP_URL, "https://manfriday.app"]
    .filter((u): u is string => !!u)
    .map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return "";
      }
    })
    .filter(Boolean),
);

export function safeRedirectPath(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  // A bare path. Reject "//evil.com" and "/\evil.com", which browsers treat as
  // protocol-relative URLs.
  if (value.startsWith("/")) {
    return /^\/[/\\]/.test(value) ? undefined : value;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (!ALLOWED_HOSTS.has(url.host)) return undefined;
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return undefined;
  }
}
