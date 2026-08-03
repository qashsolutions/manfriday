import { createClient, type User } from "@supabase/supabase-js";

/** Validates the caller's Supabase JWT (Authorization: Bearer <token>). */
export async function userFromRequest(req: Request): Promise<User | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
