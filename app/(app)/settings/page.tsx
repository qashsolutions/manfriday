import type { Metadata } from "next";
import { SettingsPanel } from "@/components/app/SettingsPanel";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false }, // app surface — never in search
};

export default function SettingsPage() {
  return <SettingsPanel />;
}
