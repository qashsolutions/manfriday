import type { Metadata } from "next";
import { POLICY } from "@/lib/site";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Privacy Policy", robots: { index: false } };

export default function PrivacyPage() {
  return (
    <div className={`wrap ${styles.legal}`}>
      <h1 className={`display ${styles.title}`}>Privacy Policy</h1>
      <p className={`mono ${styles.status}`}>LAST UPDATED 11 SEPTEMBER 2026 · counsel review before beta launch</p>

      <p>
        Man Friday collects the minimum needed to do the job:
      </p>
      <p>
        <strong>Account data</strong> — email and sign-in methods (passkeys, Google, password)
        and optional two-factor settings, handled by our auth provider, Clerk. Sessions expire
        after {POLICY.inactivityLogoutMinutes} minutes of inactivity.
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
      <h2 className={styles.h2}>YouTube</h2>
      <p>
        Man Friday uses <strong>YouTube API Services</strong> to let you publish videos to your
        own YouTube channel and to read how those videos perform. By connecting a YouTube
        account you also agree to the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>,
        and Google&apos;s handling of your data is described in the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.
      </p>
      <p>
        <strong>What we access.</strong> Through the YouTube API we request two permissions:
        upload videos (youtube.upload) and view your YouTube account (youtube.readonly). We
        use them only to (1) upload a video you approved to the channel you connected, and
        (2) read the channel name, the IDs, and the view counts of the videos Man Friday itself
        published. We do not read your other videos, comments, subscribers, playlists, or any
        data about other channels.
      </p>
      <p>
        <strong>What we store.</strong> Your OAuth access and refresh tokens (encrypted), your
        channel ID and name, and for each video Man Friday published: its YouTube video ID,
        title, publish time, and view count. View counts are refreshed at most once a day and
        kept only while the account stays connected. We never share YouTube data with third
        parties, never use it for advertising, and never sell it.
      </p>
      <p>
        <strong>Revoking access.</strong> Disconnect YouTube any time in Settings → Connected
        accounts; we revoke the token at Google and delete the stored tokens and video metadata
        within 7 days. You can also revoke Man Friday&apos;s access from your{" "}
        <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer">Google account permissions page</a>.
        Videos already on your channel are unaffected either way.
      </p>
      <h2 className={styles.h2}>TikTok</h2>
      <p>
        The same rules apply to a connected TikTok account: tokens are used only to publish
        what you approved and to read the performance of those posts, and disconnecting revokes
        the token at TikTok and deletes what we stored.
      </p>
      <h2 className={styles.h2}>Deletion and processors</h2>
      <p>
        <strong>Deletion.</strong> Settings → Your data → Delete removes your account, brand
        briefs, generated concepts, and disconnects social accounts. Posts already published
        to your own channels remain yours, on those platforms.
      </p>
      <p>
        <strong>Processors.</strong> Data is processed by Clerk (authentication), Stripe
        (payments), Convex (database), Vercel (hosting), FAL and Sarvam (voice and video
        rendering), Anthropic (text generation from your brand brief), Resend (email),
        PostHog (product analytics), and Axiom (logs). Each processor receives only what its
        job needs.
      </p>
      <p>
        <strong>Contact.</strong> Privacy questions and data requests: admin@manfriday.app.
        Man Friday is operated by Qash Solutions.
      </p>
    </div>
  );
}
