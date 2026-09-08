import type { Metadata } from "next";
import { AppProviders } from "@/components/app/Providers";
import { AppNav } from "@/components/app/AppNav";

export const metadata: Metadata = { robots: { index: false } }; // app surfaces never index

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <AppNav />
      <main>{children}</main>
    </AppProviders>
  );
}
