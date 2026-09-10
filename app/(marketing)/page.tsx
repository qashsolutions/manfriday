import { Hero } from "@/components/marketing/Hero";
import { PicksDemo } from "@/components/marketing/PicksDemo";
import { Attribution } from "@/components/marketing/Attribution";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Markets } from "@/components/marketing/Markets";
import { FoundingOffer } from "@/components/marketing/FoundingOffer";

/* Landing v2 — docs/landing-v2.md. Order is the argument: show it, prove the
   click, explain it, multiply it, price it. */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <PicksDemo />
      <Attribution />
      <HowItWorks />
      <Markets />
      <FoundingOffer />
    </>
  );
}
