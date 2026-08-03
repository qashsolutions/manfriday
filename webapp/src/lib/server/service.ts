import { createClient } from "@supabase/supabase-js";

/** Service-role client — server only. Returns null when the key isn't configured. */
export function serviceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
