import type { Metadata } from "next";
import { connection } from "next/server";
import { PreEvaluationExperience } from "@/components/pre-evaluation/experience";
import { MarketingHeader } from "@/components/flow/marketing-header";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Free credential preview | CredPronto",
  robots: ROBOTS_NOINDEX,
};

export default async function PreEvaluationResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await connection();
  return (
    <div>
      <MarketingHeader section="evaluations" />
      <PreEvaluationExperience initialId={id} />
    </div>
  );
}
