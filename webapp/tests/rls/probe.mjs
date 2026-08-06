// RLS probe — proves the database refuses strangers.
//
// Runs as the anon key ONLY (never the service-role key). For each of the
// 14 RLS tables it attempts one SELECT (must come back denied or empty) and
// one INSERT (must be rejected — expected Postgres code 42501, row-level
// security violation). Insert payloads satisfy every NOT NULL and CHECK
// constraint so a rejection can only mean RLS, not a malformed row.
//
// Prints table → pass/fail only. Never prints key values or row contents.
// Exits non-zero if any table lets anything through.
//
// Run: npm run probe:rls   (loads webapp/.env.local via node --env-file)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Run via `npm run probe:rls` from webapp/ so --env-file loads .env.local."
  );
  process.exit(2);
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Random UUIDs: auth.uid() is NULL for anon, so `auth.uid() = user_id` can
// never pass — the values only need to be well-typed.
const uid = crypto.randomUUID();
const ref = crypto.randomUUID();
const HEX = "\\x70726f6265"; // bytea literal, spells "probe"

const TABLES = [
  { name: "profiles", insert: { id: uid } },
  {
    name: "google_oauth_tokens",
    insert: { user_id: uid, google_sub: "probe", refresh_token_ciphertext: HEX },
  },
  {
    name: "export_connections",
    insert: { user_id: uid, provider: "notion", token_ciphertext: HEX },
  },
  { name: "channel_profiles", insert: { user_id: uid } },
  { name: "channels", insert: { user_id: uid, yt_channel_id: "UCprobe" } },
  { name: "videos", insert: { user_id: uid, yt_video_id: "probe000000" } },
  { name: "video_snapshots", insert: { user_id: uid, video_id: ref } },
  { name: "channel_snapshots", insert: { user_id: uid, channel_id: ref } },
  {
    name: "channel_baselines",
    insert: {
      user_id: uid,
      channel_id: ref,
      format: "longform",
      sample_size: 1,
      median_views: 1,
      mean_views: 1,
    },
  },
  { name: "monitor_state", insert: { user_id: uid, channel_id: ref } },
  {
    name: "reports",
    insert: { user_id: uid, agent: "probe", title: "probe", body_md: "probe" },
  },
  {
    name: "recommendations",
    insert: {
      user_id: uid,
      agent: "probe",
      category: "packaging",
      recommendation: "probe",
      target_type: "video",
    },
  },
  {
    name: "thumbnails",
    insert: { yt_video_id: "probe000000", quality: "hqdefault", storage_path: "probe" },
  },
  {
    name: "api_cache",
    insert: { cache_key: "probe", payload: {}, expires_at: "2000-01-01T00:00:00Z" },
  },
];

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

async function probeSelect(name) {
  const { data, error } = await supabase.from(name).select("*").limit(1);
  if (error) {
    if (MISSING_TABLE.has(error.code)) return { ok: false, note: "TABLE NOT FOUND" };
    return { ok: true, note: `denied (${error.code})` };
  }
  if (!data || data.length === 0) return { ok: true, note: "empty (0 rows)" };
  // Never print the rows themselves — the count alone is the finding.
  return { ok: false, note: `${data.length} ROW(S) VISIBLE` };
}

async function probeInsert(name, payload) {
  const { error } = await supabase.from(name).insert(payload);
  if (!error) return { ok: false, note: "WRITE SUCCEEDED" };
  if (MISSING_TABLE.has(error.code)) return { ok: false, note: "TABLE NOT FOUND" };
  const rls = error.code === "42501";
  return { ok: true, note: rls ? "denied (42501 RLS)" : `denied (${error.code})` };
}

let failures = 0;
let writes = 0;
const width = Math.max(...TABLES.map((t) => t.name.length));

console.log(`RLS probe — anon key only, ${TABLES.length} tables\n`);
for (const t of TABLES) {
  const sel = await probeSelect(t.name);
  const ins = await probeInsert(t.name, t.insert);
  if (!sel.ok || !ins.ok) failures++;
  if (ins.note === "WRITE SUCCEEDED") writes++;
  const mark = sel.ok && ins.ok ? "PASS" : "FAIL";
  console.log(
    `${mark}  ${t.name.padEnd(width)}  select: ${sel.note.padEnd(18)} insert: ${ins.note}`
  );
}

console.log(
  `\n${TABLES.length - failures}/${TABLES.length} tables refused the stranger; ` +
    `${writes === 0 ? "zero" : writes} successful write(s).`
);
if (failures > 0) {
  console.error("\nRLS PROBE FAILED — the database let something through.");
  process.exit(1);
}
