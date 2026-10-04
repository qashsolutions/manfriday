import type { Metadata } from "next";
import { AppAuthGate, AppProviders } from "@/components/app/Providers";
import { AppNav } from "@/components/app/AppNav";
import { FeedbackButton } from "@/components/app/FeedbackButton";

export const metadata: Metadata = { robots: { index: false } }; // app surfaces never index

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <AppNav />
      <main>
        <AppAuthGate>
          {children}
          <FeedbackButton />
        </AppAuthGate>
      </main>
    </AppProviders>
  );
}
