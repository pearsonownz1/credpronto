import type { Metadata } from "next";
import { PreEvaluationExperience } from "@/components/pre-evaluation/experience";
import { MarketingHeader } from "@/components/flow/marketing-header";
import { PRE_EVALUATION_CANONICAL } from "@/lib/pre-evaluation/handoff";

export const metadata: Metadata = {
  title: "Free credential preview | CredPronto",
  description:
    "Upload a diploma or transcript for a free preview of the likely U.S. equivalent. This is not an official evaluation.",
  alternates: {
    canonical: PRE_EVALUATION_CANONICAL,
  },
};

export default function PreEvaluationPage() {
  return (
    <div>
      <MarketingHeader section="evaluations" />
      <PreEvaluationExperience />
    </div>
  );
}
