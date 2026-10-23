import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaidOrderScreen } from "@/components/flow/download-states";
import { evaluationInReviewOrder } from "@/lib/dev/paid-order-fixtures";
import { paidReviewFixtureEnabled } from "@/lib/dev/paid-review-fixture";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Paid evaluation · CredPronto",
  description: "Fixture for a paid evaluation still in review.",
  robots: ROBOTS_NOINDEX,
};

export default function PaidEvaluationFixturePage() {
  if (!paidReviewFixtureEnabled()) notFound();
  const order = evaluationInReviewOrder();
  return (
    <div data-testid="paid-evaluation-fixture">
      <PaidOrderScreen order={order} token="paid-evaluation" />
    </div>
  );
}
