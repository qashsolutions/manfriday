import type { Metadata } from "next";
import { POLICY } from "@/lib/site";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Privacy Policy", robots: { index: false } };

export default function PrivacyPage() {
  return (
    <div className={`wrap ${styles.legal}`}>
      <h1 className={`display ${styles.title}`}>Privacy Policy</h1>
      <p className={`mono ${styles.status}`}>LAST UPDATED 15 SEPTEMBER 2026 · counsel review before beta launch</p>

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
      <h2 className={styles.h2}>YouTube and Google user data</h2>
      <p>
        Man Friday uses <strong>YouTube API Services</strong> to let you publish videos to your
        own YouTube channel and to read how those videos perform. By connecting a YouTube
        account you also agree to the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>,
        and Google&apos;s handling of your data is described in the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.
        &ldquo;Google user data&rdquo; below means everything we receive from Google about you
        through these permissions.
      </p>
      <p>
        <strong>What we access.</strong> We request two permissions: upload videos
        (youtube.upload) and view your YouTube account (youtube.readonly). With them we receive
        only: your OAuth access and refresh tokens, your channel ID and channel name, and, for
        each video Man Friday itself published to your channel, its video ID and its view, like,
        and comment counts. We do not read your other videos, comments, subscribers, playlists,
        watch history, or any data about other channels.
      </p>
      <h3 className={styles.h3}>How Man Friday uses Google user data</h3>
      <p>
        We use Google user data for exactly three things, all of them features you see in the
        app: (1) to upload a video to your channel after you approved it and chose a posting
        time; (2) to show which channel is connected, in Settings; (3) to show how each video
        Man Friday published is doing (views, likes, comments) in your queue and on the Analytics
        page, refreshed at most once a day. We never use Google user data to build advertising
        profiles, to serve ads, to train artificial-intelligence or machine-learning models, or
        for any purpose other than providing and improving these user-facing features.
      </p>
      <h3 className={styles.h3}>How Man Friday shares Google user data</h3>
      <p>
        We do not sell Google user data. We do not share, transfer, or disclose it to any third
        party, including advertisers, data brokers, or other users. The only party that ever
        holds it besides you and us is our database and hosting provider, Convex, which stores
        it on our behalf under a data-processing agreement and cannot use it for its own
        purposes. No other processor listed in this policy (Clerk, Stripe, FAL, Sarvam,
        Anthropic, Resend, PostHog, Axiom, Vercel) receives Google user data. We would disclose
        it only if required by law, and we would tell you unless legally prevented. If Man
        Friday is ever acquired, Google user data is transferred only under this same policy or
        one at least as protective.
      </p>
      <h3 className={styles.h3}>How Man Friday protects Google user data</h3>
      <p>
        Google user data is sensitive, and we treat it that way. It travels only over encrypted
        connections (TLS). It is stored encrypted at rest. Access and refresh tokens live only on
        our server side: they are never sent to your browser, never written to logs, and never
        passed to the video-rendering service. Before you can connect a YouTube account, your
        Man Friday account must have a passkey or two-factor authentication enabled, so a stolen
        password alone cannot reach your channel. We request the minimum permissions the features
        need and call only the three YouTube API methods those features use. Each upload happens
        only after your explicit approval; the app never uploads, edits, or deletes anything on
        its own. Access to production data is limited to the operator and is logged. If we ever
        discover a breach affecting Google user data we will notify affected users without undue
        delay at the email on their account.
      </p>
      <h3 className={styles.h3}>How long we keep it, and how you revoke it</h3>
      <p>
        Tokens and channel details are kept only while your YouTube account stays connected.
        View, like, and comment counts are refreshed at most once a day; snapshots older than 30
        days are deleted automatically. Disconnect YouTube any time in Settings → Connected
        accounts: we revoke the grant at Google immediately, delete the tokens at once, and
        delete the stored channel details and video counts within 7 days. Deleting your Man Friday
        account does the same. You can also revoke Man Friday&apos;s access from your{" "}
        <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer">Google account permissions page</a>;
        the app then stops working for that channel and asks you to reconnect. Videos already on
        your channel are unaffected in every case.
      </p>
      <p>
        <strong>Limited Use.</strong> Man Friday&apos;s use and transfer of information received
        from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>
      <h2 className={styles.h2}>Your presenter photo</h2>
      <p>
        If you add a presenter photo in Settings, we store it and use it for exactly one thing:
        placing it at the start of the presenter videos you approve, rendered by our own video
        worker. It is never animated or altered beyond cropping. You attest that the photo is of
        you or of someone who gave you written permission. We never use the photo to train models,
        never share it with anyone, and never show it to other users. Remove the photo any time in
        Settings; it is deleted immediately, and deleting your account deletes it too.
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
