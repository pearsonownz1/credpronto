import { describe, expect, it } from "vitest";
import { paymentStatusForCustomer, summarizeCustomerOrder } from "./account-summary";
import { EVALUATION_REVIEW_REASON } from "./evaluation-price";
import { QA_REVIEW_REASON } from "./qa";
import { HIGH_QA_SCORE } from "./release-decision";

describe("customer order summary", () => {
  it("prefers a settled payment over a newer failure", () => {
    expect(
      paymentStatusForCustomer([
        { status: "failed", createdAt: "2026-10-12T02:00:00Z" },
        { status: "paid", createdAt: "2026-10-12T01:00:00Z" },
      ]),
    ).toBe("paid");
  });

  it("reports the newest status when nothing has settled", () => {
    expect(
      paymentStatusForCustomer([
        { status: "pending", createdAt: "2026-10-12T01:00:00Z" },
        { status: "refunded", createdAt: "2026-10-12T02:00:00Z" },
      ]),
    ).toBe("refunded");
  });

  it("exposes preview and download availability", () => {
    const ready = summarizeCustomerOrder({
      id: "order-1",
      status: "paid",
      serviceType: "translation",
      totalCents: 995,
      currency: "usd",
      billablePages: 1,
      unitPriceCents: 995,
      createdAt: "2026-10-12T00:00:00Z",
      previewReady: true,
      paymentStatus: "paid_test",
      deliveryStatus: "approved",
    });
    expect(ready.previewAvailable).toBe(true);
    expect(ready.downloadAvailable).toBe(true);
    expect(ready.paymentStatus).toBe("paid_test");
    expect(ready.totalCents).toBe(995);

    const refunded = summarizeCustomerOrder({
      ...{
        id: "order-1",
        status: "paid",
        serviceType: "translation",
        totalCents: 995,
        currency: "usd",
        billablePages: 1,
        unitPriceCents: 995,
        createdAt: "2026-10-12T00:00:00Z",
        previewReady: true,
        paymentStatus: "refunded",
        deliveryStatus: "delivered",
      },
    });
    expect(refunded.downloadAvailable).toBe(false);
    expect(refunded.previewAvailable).toBe(true);
    expect(refunded.translationReady).toBe(false);
  });

  it("marks a paid bundle ready to download its certified translation", () => {
    const translation = "0301d079-8368-40d8-854d-95475933124f/certified-translation-v1.pdf";
    const input = {
      id: "0301d079-8368-40d8-854d-95475933124f",
      status: "paid",
      serviceType: "evaluation",
      totalCents: 2990,
      currency: "usd",
      billablePages: 1,
      unitPriceCents: 995,
      createdAt: "2026-10-21T14:25:35.957Z",
      previewReady: true,
      paymentStatus: "paid",
      deliveryStatus: "pending" as const,
      includeTranslation: true,
      finalTranslationPath: translation,
      certificationPath: translation,
      reviewReason: EVALUATION_REVIEW_REASON,
      qa: { status: "pass" as const, score: HIGH_QA_SCORE },
      languageConfidence: 0.96,
      pageNeedsReview: false,
      openCorrections: false,
      autoReleaseEnabled: true,
    };
    const bundle = summarizeCustomerOrder(input);
    expect(bundle.downloadAvailable).toBe(false);
    expect(bundle.translationReady).toBe(true);
    expect(bundle.includeTranslation).toBe(true);

    const flagged = summarizeCustomerOrder({
      ...input,
      reviewReason: QA_REVIEW_REASON,
      qa: { status: "fail", score: 40 },
    });
    expect(flagged.translationReady).toBe(false);
    expect(flagged.downloadAvailable).toBe(false);
  });
});
