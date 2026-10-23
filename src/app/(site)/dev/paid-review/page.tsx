import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaidOrderScreen } from "@/components/flow/download-states";
import { PaidReviewFixturePreview } from "@/components/flow/paid-review-fixture-preview";
import type { PreviewOrder } from "@/components/preview/preview-order";
import { translationInReviewOrder } from "@/lib/dev/paid-order-fixtures";
import { needsReviewFixture, paidReviewFixtureEnabled } from "@/lib/dev/paid-review-fixture";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Paid review · CredPronto",
  description: "Fixture for a paid translation still in review.",
  robots: ROBOTS_NOINDEX,
};

const SAMPLE_ORIGINAL = "/samples/birth-certificate-es.pdf";
const SAMPLE_TRANSLATION = "/samples/birth-certificate-en.pdf";

function fixturePreview(fixture: { id: string; totalCents: number | null; billablePages: number | null }): PreviewOrder {
  const pages = Math.max(1, fixture.billablePages ?? 1);
  const pageSize = { widthPt: 612, heightPt: 792 };
  const sheet = Array.from({ length: pages }, (_, index) => ({
    page: index + 1,
    ...pageSize,
    documentId: fixture.id,
  }));
  return {
    id: fixture.id,
    status: "preview_ready",
    product: "translation",
    sourceLanguage: "Original",
    targetLanguage: "English",
    filename: "Document",
    pageCount: pages,
    original: { url: SAMPLE_ORIGINAL, subtitle: "Original", pages: sheet },
    translation: { url: SAMPLE_TRANSLATION, subtitle: "English · watermarked preview", pages: sheet },
    pricing: {
      perPageCents: 995,
      pages,
      certificationIncluded: true,
      totalCents: fixture.totalCents ?? 0,
    },
    included: [],
    corrections: [],
  };
}

export default function PaidReviewFixturePage() {
  if (!paidReviewFixtureEnabled()) notFound();
  const fixture = needsReviewFixture();
  if (!fixture) notFound();
  const order = translationInReviewOrder(fixture);

  return (
    <div data-testid="paid-review-fixture">
      <PaidOrderScreen
        order={order}
        token="paid-review"
        preview={<PaidReviewFixturePreview order={fixturePreview(fixture)} />}
      />
    </div>
  );
}
