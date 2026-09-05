import type { Metadata } from "next";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Terms of Service", robots: { index: false } };

export default function TermsPage() {
  return (
    <div className={`wrap ${styles.legal}`}>
      <h1 className={`display ${styles.title}`}>Terms of Service</h1>
      <p className={`mono ${styles.status}`}>DRAFT — final terms ship with the beta launch.</p>
      <p>
        The short version while the lawyers do the long one: you own your content — what
        Friday drafts for you is yours; nothing publishes without your explicit approval (the
        right-swipe); you&apos;re responsible for what you approve complying with each
        platform&apos;s rules; prepaid terms are non-refundable after the first 14 days;
        monthly cancels anytime.
      </p>
      <p>[FULL TERMS — reviewed before launch: license, acceptable use, billing terms, liability, termination.]</p>
    </div>
  );
}
