import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import styles from "../auth.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className={styles.authCol} style={{ minHeight: "calc(100vh - 61px)" }}>
      <SignIn routing="hash" signUpUrl="/signup" fallbackRedirectUrl="/picks" />
      <p className={styles.signin}>
        New here? <Link href="/signup">Hire Friday</Link>
      </p>
    </div>
  );
}
