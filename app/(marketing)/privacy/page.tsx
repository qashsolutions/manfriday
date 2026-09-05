import type { Metadata } from "next";
import { TRIAL } from "@/lib/site";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Privacy Policy", robots: { index: false } };

export default function PrivacyPage() {
  return (
    <div className={`wrap ${styles.legal}`}>
      <h1 className={`display ${styles.title}`}>Privacy Policy</h1>
      <p className={`mono ${styles.status}`}>DRAFT — final policy reviewed before beta launch.</p>

      <p>
        Man Friday collects the minimum needed to do the job:
      </p>
      <p>
        <strong>Account data</strong> — email and sign-in methods (passkeys, Google, password)
        and optional two-factor settings, handled by our auth provider, Clerk. Sessions expire
        after {TRIAL.inactivityLogoutMinutes} minutes of inactivity.
      </p>
      <p>
        <strong>Your product&apos;s public website</strong> — read once to write your brand
        brief (product, audience, tone, niche, language). You review and can edit everything
        we inferred.
      </p>
      <p>
        <strong>Connected social accounts</strong> — OAuth tokens for the TikTok and YouTube
        accounts you explicitly connect, used only to publish what you approved and to read
        the performance of those posts. Tokens are encrypted and never leave our server
        environment.
      </p>
      <p>
        <strong>Payment details</strong> — go directly to Stripe; card numbers never touch our
        servers.
      </p>
      <p>
        <strong>Product analytics</strong> — which features get used and how posts perform, to
        make Friday better at the job. We don&apos;t sell personal data. Ever.
      </p>
      <p>
        <strong>Deletion.</strong> Settings → Your data → Delete removes your account, brand
        briefs, generated concepts, and disconnects social accounts. Posts already published
        to your own channels remain yours, on those platforms.
      </p>
      <p>[FULL POLICY — reviewed before launch: data categories and retention table, processors (Clerk, Stripe, Convex, Vercel, FAL, Anthropic, Resend, PostHog, Axiom), regional rights (GDPR/DPDP/LGPD), contact.]</p>
    </div>
  );
}
