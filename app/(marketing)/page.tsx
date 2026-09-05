import { Hero } from "@/components/marketing/Hero";
import { SwipeStrip } from "@/components/marketing/SwipeStrip";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { ProofBand } from "@/components/marketing/ProofBand";
import { FoundingOffer } from "@/components/marketing/FoundingOffer";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <SwipeStrip />
      <HowItWorks />
      <ProofBand />
      <FoundingOffer />
    </>
  );
}
