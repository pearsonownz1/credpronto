import type { Metadata } from "next";
import { LandingView } from "@/components/flow/landing-view";

export const metadata: Metadata = {
  title: "Your documents. Ready, pronto. · CredPronto",
  description:
    "Certified translations from $9.95/page. Upload now, see the full translation in about 10 minutes, and only pay if it’s right.",
};

export default function Home() {
  return <LandingView />;
}
