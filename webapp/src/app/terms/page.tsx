import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/Site";

export const metadata: Metadata = { title: "Terms of service — manfriday" };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="site-wrap">
        <div className="prose">
          <span className="eyebrow">Legal</span>
          <h1>Terms of service</h1>
          <p className="updated">Last updated: August 3, 2026</p>

          <p>
            These terms govern your use of manfriday.app (&quot;manfriday&quot;, &quot;we&quot;).
            By creating an account you agree to them. Plain English throughout — if anything is
            unclear, ask us before relying on it.
          </p>

          <h2>What manfriday is</h2>
          <ul>
            <li>An analytics service that reads your own YouTube channel&apos;s data (read-only, with your permission) and produces analyses, recommendations, and reports.</li>
            <li>New accounts start with a <b>one-week trial</b>. After the trial, continued use requires a paid plan — you&apos;ll always see the price and confirm before anything is charged.</li>
            <li>manfriday is in <b>early access</b>: features may change, break, or be withdrawn while we build; we&apos;ll communicate before anything you rely on disappears.</li>
            <li>manfriday is not affiliated with or endorsed by YouTube or Google. Using it also means agreeing to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>.</li>
          </ul>

          <h2>Your account</h2>
          <ul>
            <li>You must be at least 16 and connect only channels you own or are authorized to manage.</li>
            <li>Keep your sign-in secure; you&apos;re responsible for activity under your account.</li>
            <li>One person, one account. Don&apos;t resell access or scrape the service.</li>
          </ul>

          <h2>The advice</h2>
          <ul>
            <li>Our analysts produce judgments from your data. They are honest, grounded, and checked after the fact — but they are <b>recommendations, not guarantees</b>. You decide what to publish and remain responsible for your channel.</li>
            <li>We deliberately track outcomes (the Ledger) and show misses. Past &quot;worked&quot; verdicts don&apos;t promise future results.</li>
          </ul>

          <h2>Your data</h2>
          <ul>
            <li>Your channel data stays yours. How we collect, store, and delete it is in the <a href="/privacy">privacy policy</a>.</li>
            <li>You can export, pause, disconnect, or delete at any time from Settings. Deleting your account removes your data and revokes our access at Google.</li>
          </ul>

          <h2>Acceptable use</h2>
          <ul>
            <li>Don&apos;t use manfriday to violate YouTube&apos;s policies, anyone&apos;s rights, or applicable law.</li>
            <li>Don&apos;t probe, overload, or interfere with the service, and don&apos;t attempt to access other users&apos; data.</li>
          </ul>

          <h2>Liability</h2>
          <ul>
            <li>manfriday is provided &quot;as is&quot; during early access, without warranties of any kind.</li>
            <li>To the maximum extent permitted by law, we are not liable for indirect or consequential damages — including lost revenue, lost subscribers, or changes in your channel&apos;s performance. Our total liability is capped at the amount you paid us in the past 12 months.</li>
          </ul>

          <h2>Ending things</h2>
          <ul>
            <li>You can delete your account whenever you like.</li>
            <li>We may suspend accounts that break these terms, and will say why unless legally prevented.</li>
          </ul>

          <h2>Changes and contact</h2>
          <p>
            We may update these terms as the product evolves; material changes will be noted in the
            app. Questions: <a href="mailto:hello@manfriday.app">hello@manfriday.app</a>.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
