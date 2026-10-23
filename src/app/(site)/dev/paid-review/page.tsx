import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaidReviewBody } from "@/components/flow/download-states";
import { FlowHeader } from "@/components/flow/flow-header";
import { PaidReviewFixturePreview } from "@/components/flow/paid-review-fixture-preview";
import type { PreviewOrder } from "@/components/preview/preview-order";
import { needsReviewFixture, paidReviewFixtureEnabled } from "@/lib/dev/paid-review-fixture";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Paid review · CredPronto",
  description: "Fixture for a paid translation still in final review.",
  robots: ROBOTS_NOINDEX,
};

/** Public samples already used by the mock preview. Not loaded from an order. */
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

  return (
    <div data-testid="paid-review-fixture">
      <FlowHeader current="download" track="translation" />
      <main className="mx-auto w-full max-w-6xl px-4 pt-10 pb-16">
        <PaidReviewBody
          orderId={fixture.id}
          email={fixture.email}
          totalCents={fixture.totalCents}
          paidAt={fixture.paidAt}
          preview={<PaidReviewFixturePreview order={fixturePreview(fixture)} />}
        />
      </main>
    </div>
  );
}
