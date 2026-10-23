import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaidOrderScreen } from "@/components/flow/download-states";
import { translationReadyOrder } from "@/lib/dev/paid-order-fixtures";
import { paidReviewFixtureEnabled } from "@/lib/dev/paid-review-fixture";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Paid ready · CredPronto",
  description: "Fixture for a delivered translation.",
  robots: ROBOTS_NOINDEX,
};

const SAMPLE_TRANSLATION = "/samples/birth-certificate-en.pdf";

export default function PaidReadyFixturePage() {
  if (!paidReviewFixtureEnabled()) notFound();
  const order = translationReadyOrder();
  return (
    <div data-testid="paid-ready-fixture">
      <PaidOrderScreen
        order={order}
        token="paid-ready"
        downloadHref={SAMPLE_TRANSLATION}
      />
    </div>
  );
}
