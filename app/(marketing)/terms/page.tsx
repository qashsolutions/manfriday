import type { Metadata } from "next";
import { TIERS, FREE, TOPUP, POLICY, FOUNDING } from "@/lib/site";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Terms of Service", robots: { index: false } };

export default function TermsPage() {
  return (
    <div className={`wrap ${styles.legal}`}>
      <h1 className={`display ${styles.title}`}>Terms of Service</h1>
      <p className={`mono ${styles.status}`}>LAST UPDATED 11 SEPTEMBER 2026 · counsel review before beta launch</p>

      <h2 className={styles.h2}>The plain-language version</h2>
      <p>
        <strong>Your content is yours.</strong> Everything Friday drafts for your product
        belongs to you. Nothing is ever published without your explicit approval — the
        right-swipe is the gate — and you&apos;re responsible for what you approve complying
        with each platform&apos;s rules and with the law in your market.
      </p>
      <p>
        <strong>Free plan.</strong> Accounts start free with no card: browse the full Picks
        feed and render {FREE.videosTotal} videos on us (one-time allowance). A card is
        required only when you subscribe to a paid plan.
      </p>
      <p>
        <strong>Plans and billing.</strong> Two tiers ({TIERS[0].name} and {TIERS[1].name}),
        billed monthly, quarterly, annually, or as a 3-year prepaid term. Monthly plans cancel
        anytime, effective at period end. Quarterly and annual prepaid terms are refundable
        within the first 14 days, then non-refundable. The <strong>{FOUNDING.label} 3-year
        plan is pay-today, non-cancellable, and non-refundable</strong> — it is limited to the
        first {FOUNDING.cap} customers and priced accordingly. Monthly video allowances
        reset each month and don&apos;t roll over. Top-up packs (+{TOPUP.videos} videos for $
        {TOPUP.price}) are for paid plans; top-up videos are used after the monthly allowance
        and stay available while your plan is active. A video counts against your allowance
        when you keep it; if Man Friday fails to render it, it is given back. Payments are
        processed by Stripe; Man Friday never sees or stores card details.
      </p>
      <p>
        <strong>Pausing.</strong> Any paid plan can be paused for up to {POLICY.pauseMaxDays} days,
        once every 30 days. Scheduled posts are held during a pause, and paused days are added
        to the end of your current term.
      </p>
      <p>
        <strong>Sessions and security.</strong> Sessions sign out automatically after{" "}
        {POLICY.inactivityLogoutMinutes} minutes of inactivity. Keep your sign-in methods
        (passkeys, password, 2FA) to yourself; you&apos;re responsible for activity under your
        account.
      </p>
      <p>
        <strong>Acceptable use.</strong> No content that&apos;s unlawful, deceptive, or
        violates platform policies; no reselling access; no scraping other users&apos; data.
        We can suspend accounts that put the platform integrations at risk.
      </p>
      <p>
        <strong>Platform terms.</strong> Publishing goes through each platform&apos;s official
        API. When you connect a YouTube channel you agree to be bound by the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>{" "}
        and the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>;
        when you connect TikTok you agree to TikTok&apos;s terms. Man Friday is not affiliated
        with or endorsed by YouTube, Google, or TikTok.
      </p>
      <p>
        <strong>License.</strong> You grant Man Friday a limited license to process your
        product&apos;s public website and the content you approve, solely to draft, render,
        schedule, and publish videos on your behalf. Man Friday claims no ownership of your
        content or your channels.
      </p>
      <p>
        <strong>Changes.</strong> We may update these terms; material changes are announced by
        email at least 14 days before they take effect. Liability limits, dispute resolution,
        and governing law are finalised in the counsel-reviewed version before beta launch.
      </p>
      <p>
        <strong>Operator.</strong> Man Friday is operated by Qash Solutions. Contact:
        admin@manfriday.app.
      </p>
    </div>
  );
}
