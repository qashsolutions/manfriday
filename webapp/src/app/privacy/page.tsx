import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/Site";

export const metadata: Metadata = { title: "Privacy policy — manfriday" };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="site-wrap">
        <div className="prose">
          <span className="eyebrow">Legal</span>
          <h1>Privacy policy</h1>
          <p className="updated">Last updated: August 3, 2026</p>

          <p>
            manfriday.app (&quot;manfriday&quot;, &quot;we&quot;) is an analytics service for YouTube creators.
            The short version: we read your channel&apos;s data so our analysts can work for you, we never
            sell it or post anything on your behalf, and deleting your account deletes your data.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li><b>Account:</b> your email address, and — if you sign in with Google — your name and profile picture from your Google account.</li>
            <li><b>YouTube data (read-only), only after you explicitly connect a channel:</b> your channel and video statistics, video metadata (titles, descriptions, thumbnails), audience-retention curves, traffic-source summaries, and public comments on your videos.</li>
            <li><b>Work product:</b> the analyses, reports, tips, and idea lists our analysts produce for you.</li>
            <li>We do <b>not</b> collect your YouTube password, and we request no permission to change, upload, or delete anything on your channel.</li>
          </ul>

          <h2>How we use it</h2>
          <ul>
            <li>To produce your analyses: baselines, retention reads, title grades, comment-mined ideas, and weekly reports.</li>
            <li>Portions of your channel data (numbers, titles, retention points, comments) are sent to Anthropic&apos;s Claude API to generate those analyses. Anthropic does not train its models on this data.</li>
            <li>We do not sell your data, show you ads, or share your data with anyone except the service providers below.</li>
          </ul>

          <h2>Google and YouTube</h2>
          <ul>
            <li>manfriday uses YouTube API Services. By using it you also agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>. Google&apos;s <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> governs Google&apos;s handling of your data.</li>
            <li>manfriday&apos;s use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
            <li>You can revoke manfriday&apos;s access at any time in your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google security settings</a>, or with one click under Settings → Connections — disconnecting also revokes the token at Google and deletes it from our systems.</li>
          </ul>

          <h2>How your data is stored</h2>
          <ul>
            <li>Data lives in our database at Supabase; the app runs on Vercel. Access is protected by per-user security rules — your rows are readable by your account only.</li>
            <li>The YouTube refresh token that lets us read your channel is encrypted at the application layer before it is stored, and is never exposed to your browser.</li>
            <li>Cached YouTube API responses are kept briefly for performance and purged automatically, consistent with YouTube&apos;s data policies.</li>
          </ul>

          <h2>Your controls</h2>
          <ul>
            <li><b>Download:</b> Settings → Your data exports everything we hold about you as a file.</li>
            <li><b>Pause:</b> Settings → pause stops all analysis until you resume.</li>
            <li><b>Delete:</b> Settings → delete removes your account and all associated data — channel records, snapshots, analyses, reports, tips — and revokes our access at Google first. This is immediate and irreversible.</li>
          </ul>

          <h2>Contact</h2>
          <p>Questions or requests: <a href="mailto:hello@manfriday.app">hello@manfriday.app</a>.</p>
          <p>We&apos;ll update this page as the product evolves; material changes will be noted in the app.</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
