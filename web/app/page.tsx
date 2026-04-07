"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LandingPage from "@/components/LandingPage";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/wiki");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  if (checking) return null;

  return <LandingPage />;
}
