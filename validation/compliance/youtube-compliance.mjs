#!/usr/bin/env node
/**
 * YouTube API Services compliance guard — runs in CI on every push and weekly.
 * Fails the build if the code or the live legal pages drift from what we
 * declared to Google (OAuth verification + quota audit, 11–12 Sep 2026).
 *
 *   node validation/compliance/youtube-compliance.mjs            # static + live
 *   node validation/compliance/youtube-compliance.mjs --static   # no network
 *
 * Any change that makes this script fail needs, in this order: (1) a written
 * notice to YouTube of the changed use case, (2) approval, (3) an update to
 * the DECLARED block below in the same commit. See CLAUDE.md › YouTube API compliance.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DECLARED = {
  scopes: [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ],
  // Every googleapis.com / oauth2.googleapis.com URL the code may contain.
  endpoints: [
    "https://oauth2.googleapis.com/token",
    "https://oauth2.googleapis.com/revoke",
    "https://www.googleapis.com/youtube/v3/channels", // channels.list, mine=true
    "https://www.googleapis.com/upload/youtube/v3/videos", // videos.insert
    "https://www.googleapis.com/youtube/v3/videos", // videos.list (stats)
  ],
  privacyMustContain: [
    "YouTube API Services",
    "https://policies.google.com/privacy",
    "https://security.google.com/settings/security/permissions",
    "https://www.youtube.com/t/terms",
    "youtube.upload",
    "youtube.readonly",
    "Disconnect",
  ],
  termsMustContain: ["https://www.youtube.com/t/terms", "https://policies.google.com/privacy"],
  productName: "Man Friday",
};

const failures = [];
const ok = (msg) => console.log("  ok   " + msg);
const fail = (msg) => { failures.push(msg); console.log("  FAIL " + msg); };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "_generated", ".venv", ".git", "templates"].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ([".ts", ".tsx", ".py", ".js", ".mjs"].includes(extname(p))) out.push(p);
  }
  return out;
}

console.log("== static checks ==");
const files = ["convex", "app", "components", "lib", "worker"].flatMap((d) => walk(d));
const sources = files.map((f) => [f, readFileSync(f, "utf8")]);

// 1. Scopes: exactly the declared set, defined once.
const scopeDefs = sources.filter(([, s]) => /GOOGLE_SCOPES\s*=/.test(s));
if (scopeDefs.length !== 1) fail(`GOOGLE_SCOPES must be defined exactly once (found ${scopeDefs.length})`);
else {
  const src = scopeDefs[0][1];
  const m = src.match(/GOOGLE_SCOPES\s*=\s*\n?\s*"([^"]+)"/);
  const got = m ? m[1].split(/\s+/).sort() : [];
  const want = [...DECLARED.scopes].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`GOOGLE_SCOPES drifted: ${got.join(" ")}`);
  else ok("scopes match the declared set (youtube.upload, youtube.readonly)");
}
for (const [f, s] of sources) {
  const extra = (s.match(/googleapis\.com\/auth\/[a-z.\-_]+/g) ?? []).filter((u) => !DECLARED.scopes.includes("https://www." + u.replace(/^www\./, "")) && !DECLARED.scopes.some((d) => d.endsWith(u.split("/auth/")[1])));
  if (extra.length) fail(`${f}: undeclared scope(s) ${[...new Set(extra)].join(", ")}`);
}

// 2. Endpoints: every googleapis URL must be in the allowlist; search.list never.
for (const [f, s] of sources) {
  const urls = s.match(/https:\/\/(?:www\.|oauth2\.)?googleapis\.com\/[^\s"'`)?]+/g) ?? [];
  for (const u of urls) {
    if (u.includes("/auth/")) continue;
    if (!DECLARED.endpoints.some((e) => u.startsWith(e))) fail(`${f}: undeclared Google endpoint ${u}`);
  }
  if (/youtube\/v3\/search/.test(s)) fail(`${f}: search.list is not part of the declared use case`);
  if (/youtube\/v3\/(commentThreads|comments|subscriptions|playlists|playlistItems|activities)/.test(s)) fail(`${f}: endpoint outside the declared use case`);
}
// videos.list may only look up OUR video IDs (id=…, part=statistics) — never chart/myRating/mine listings.
for (const [f, s] of sources) {
  for (const m of s.matchAll(/youtube\/v3\/videos\?([^"'`\s]+)/g)) {
    const qs = m[1];
    if (qs.includes("uploadType")) continue;
    if (!/(^|&)id=/.test(qs) || /chart=|myRating=|mine=/.test(qs)) fail(`${f}: videos.list must be id-scoped to our own uploads (${qs})`);
    if (!/part=statistics/.test(qs)) fail(`${f}: videos.list must request part=statistics only`);
  }
}
ok("no undeclared Google endpoints; search.list absent; videos.list id-scoped");

// 3. Tokens never leave the server: no public query/mutation returns token fields.
for (const [f, s] of sources) {
  if (!f.startsWith("convex/")) continue;
  const publicBlocks = s.split(/export const \w+ = (?:query|mutation)\(/).slice(1);
  for (const block of publicBlocks) {
    const body = block.split(/\nexport const /)[0];
    if (/return[^;]*\b(accessToken|refreshToken)\b/.test(body) && !/accessToken: ""/.test(body)) fail(`${f}: a public function returns a token field`);
  }
  if (/console\.(log|info|warn|error)\([^)]*\b(accessToken|refreshToken|access_token|refresh_token)\b/.test(s)) fail(`${f}: token value logged`);
}
ok("no public function returns tokens; no token logging");

// 4. Auth-expiry and disconnect wipe both tokens (data-retention rule).
const oauth = readFileSync("convex/oauth.ts", "utf8");
const wipes = (oauth.match(/accessToken: "",\s*refreshToken: ""/g) ?? []).length;
if (wipes < 2) fail(`convex/oauth.ts: expected token wipe in both markAuthExpired and disconnect (found ${wipes})`);
else ok("disconnect and auth-expiry wipe tokens");
if (!/revokeAtProvider/.test(oauth)) fail("convex/oauth.ts: revokeAtProvider missing");
if (!/api\.account\.purgeMine/.test(readFileSync("components/app/SettingsPanel.tsx", "utf8"))) fail("Settings delete flow no longer purges Convex data");
else ok("delete-account flow purges Convex data before deleting the Clerk user");

// 5. Uploads only for the user's own, fully rendered concepts.
const pub = readFileSync("convex/publishing.ts", "utf8");
if (!/concept\.userId !== userId/.test(pub) || !/concept\.status !== "rendered"/.test(pub)) fail("publishing.ts: schedule gate (own concept + rendered) missing");
else ok("schedule gate: own concept, fully rendered, user-initiated");

// 6. Branding: product name must not contain "YouTube".
if (/youtube/i.test(DECLARED.productName)) fail("product name contains YouTube");
const site = readFileSync("lib/site.ts", "utf8");
if (/name:\s*"[^"]*YouTube[^"]*"/i.test(site)) fail("lib/site.ts: a product/site name contains YouTube");
ok("branding: product name does not contain YouTube");

// 7. Legal pages in source contain the required disclosures (static copy of the live check).
const privacySrc = readFileSync("app/(marketing)/privacy/page.tsx", "utf8");
for (const needle of DECLARED.privacyMustContain) if (!privacySrc.includes(needle)) fail(`privacy page source missing: ${needle}`);
const termsSrc = readFileSync("app/(marketing)/terms/page.tsx", "utf8");
for (const needle of DECLARED.termsMustContain) if (!termsSrc.includes(needle)) fail(`terms page source missing: ${needle}`);
if (/\[[A-Z][A-Z .—:]+\]/.test(privacySrc) || /\[[A-Z][A-Z .—:]+\]/.test(termsSrc)) fail("legal page still has a bracketed placeholder");
ok("legal page sources carry the YouTube disclosures");

if (!process.argv.includes("--static")) {
  console.log("== live checks (manfriday.app) ==");
  const get = async (path) => {
    const r = await fetch("https://manfriday.app" + path, { redirect: "follow" });
    return [r.status, await r.text()];
  };
  const [ps, privacy] = await get("/privacy");
  if (ps !== 200) fail(`/privacy returned ${ps}`);
  for (const needle of DECLARED.privacyMustContain) if (!privacy.includes(needle)) fail(`live /privacy missing: ${needle}`);
  const [ts, terms] = await get("/terms");
  if (ts !== 200) fail(`/terms returned ${ts}`);
  for (const needle of DECLARED.termsMustContain) if (!terms.includes(needle)) fail(`live /terms missing: ${needle}`);
  const [hs, home] = await get("/");
  if (hs !== 200) fail(`/ returned ${hs}`);
  if (!/href="\/privacy"/.test(home)) fail("live homepage has no Privacy Policy link");
  if (!/YouTube/.test(home)) fail("live homepage no longer names YouTube (reviewers look for it)");
  if (failures.length === 0) ok("live privacy, terms, and homepage carry the declared disclosures");
}

console.log(failures.length ? `\n${failures.length} compliance failure(s)` : "\nall compliance checks passed");
process.exit(failures.length ? 1 : 0);
