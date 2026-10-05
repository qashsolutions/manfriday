/** Every route a signed-out visitor can reach, and every one behind sign-in.
 *  Keep in step with app/ — a route missing here is a route nothing checks. */
export const PUBLIC_PAGES = [
  { path: "/", name: "landing" },
  { path: "/pricing", name: "pricing" },
  { path: "/blog", name: "blog index" },
  { path: "/login", name: "sign in" },
  { path: "/signup", name: "sign up" },
  { path: "/privacy", name: "privacy" },
  { path: "/terms", name: "terms" },
] as const;

export const PUBLIC_FEEDS = ["/sitemap.xml", "/robots.txt", "/feed.xml"] as const;

export const APP_PAGES = [
  { path: "/picks", name: "picks" },
  { path: "/calendar", name: "calendar" },
  { path: "/analytics", name: "analytics" },
  { path: "/settings", name: "settings" },
] as const;

/** Reachable only by an operator account. */
export const ADMIN_PAGES = [{ path: "/admin", name: "operator" }] as const;
