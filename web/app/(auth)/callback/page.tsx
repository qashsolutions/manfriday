"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function CallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          setError(sessionError.message);
          return;
        }

        if (!data.session) {
          // Try exchanging the code from URL hash/params
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(
              window.location.href.split("code=")[1]?.split("&")[0] || ""
            );

          if (exchangeError) {
            setError(exchangeError.message);
            return;
          }
        }

        // Check if user has completed BYOK setup
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          // Redirect to key setup if new user, otherwise to wiki
          router.replace("/setup/key");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed.");
      }
    }

    handleCallback();
  }, [router]);

  if (error) {
    return (
      <div className="card text-center space-y-4">
        <h2 className="text-lg font-semibold text-red-400">Authentication Error</h2>
        <p className="text-gray-400 text-sm">{error}</p>
        <a href="/signup" className="btn-primary inline-block">
          Back to Sign Up
        </a>
      </div>
    );
  }

  return (
    <div className="card text-center space-y-4">
      <div className="flex justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="text-gray-400 text-sm">Completing sign in...</p>
    </div>
  );
}
