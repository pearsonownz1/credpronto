import type { Metadata } from "next";
import { MarketingHeader } from "@/components/flow/marketing-header";
import { PrevalLanding } from "@/components/preval/landing";
import { PREVAL_CANONICAL, PREVAL_DESCRIPTION, PREVAL_TITLE } from "@/lib/seo";

export const metadata: Metadata = {
  title: PREVAL_TITLE,
  description: PREVAL_DESCRIPTION,
  alternates: {
    canonical: PREVAL_CANONICAL,
  },
};

export default function PrevalPage() {
  return (
    <div>
      <MarketingHeader section="preval" />
      <PrevalLanding />
    </div>
  );
}
