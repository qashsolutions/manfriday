import Link from "next/link";
import { Bolt, Wordmark } from "@/components/ui/Logo";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 32px",
          borderBottom: "1px solid var(--edge)",
        }}
      >
        <Link href="/" aria-label="Man Friday home" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink)" }}>
          <Bolt size={18} />
          <Wordmark size={15} />
        </Link>
        <nav className="mono" style={{ display: "flex", gap: 24, fontSize: 12, letterSpacing: "0.08em" }} aria-label="App">
          <span style={{ color: "var(--faint)" }}>PICKS</span>
          <span style={{ color: "var(--faint)" }}>CALENDAR</span>
          <span style={{ color: "var(--faint)" }}>ANALYTICS</span>
          <span style={{ color: "var(--ink)" }}>SETTINGS</span>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
