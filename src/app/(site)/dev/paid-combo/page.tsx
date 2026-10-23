import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaidOrderScreen } from "@/components/flow/download-states";
import { comboTranslationDoneOrder } from "@/lib/dev/paid-order-fixtures";
import { paidReviewFixtureEnabled } from "@/lib/dev/paid-review-fixture";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Paid combo · CredPronto",
  description: "Fixture for a translation that is done while the evaluation is still pending.",
  robots: ROBOTS_NOINDEX,
};

export default function PaidComboFixturePage() {
  if (!paidReviewFixtureEnabled()) notFound();
  const order = comboTranslationDoneOrder();
  return (
    <div data-testid="paid-combo-fixture">
      <PaidOrderScreen order={order} token="paid-combo" />
    </div>
  );
}
