import Link from "next/link";
import { Bolt, Wordmark } from "@/components/ui/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 40px",
          borderBottom: "1px solid var(--edge)",
        }}
      >
        <Link href="/" aria-label="Man Friday home" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink)" }}>
          <Bolt size={18} />
          <Wordmark size={15} />
        </Link>
        <span className="mono" style={{ fontSize: 12, color: "var(--faint)", letterSpacing: "0.08em" }}>
          HIRING FRIDAY · CREATE ACCOUNT
        </span>
      </header>
      <main>{children}</main>
    </>
  );
}
