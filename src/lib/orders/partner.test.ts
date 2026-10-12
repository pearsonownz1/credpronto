import { describe, expect, it } from "vitest";
import { EVALUATION_REVIEW_REASON, partnerQuoteAction, toPartnerOrder } from "./partner";
import type { OrderRecord } from "./types";

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: "user-1",
    serviceType: "translation",
    status: "quoted",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 3,
    unitPriceCents: 995,
    totalCents: 2985,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: null,
    certificationPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: "crm-1842",
    orderType: "translation",
    service: null,
    degreeCount: null,
    evaluationCents: null,
    translationCents: null,
    evaluationResult: null,
    addonCents: 0,
    expedited: false,
    shippingAddress: null,
    mailStatus: null,
    mailTracking: null,
    notarizationStatus: null,
    edgeCredentialId: null,
    edgeGradingScaleId: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    ...patch,
  };
}

describe("partner orders", () => {
  it("prices a quoted order and overrides a language-only hold", () => {
    const priced = {
      status: "quoted",
      billablePages: 3,
      totalCents: 2985,
      reviewReason: null,
      sourceLanguage: "es",
      service: "translation" as const,
    };
    expect(partnerQuoteAction(priced)).toBe("use");
    expect(
      partnerQuoteAction({
        ...priced,
        status: "needs_review",
        reviewReason: "Language detection confidence is low (0.20).",
      }),
    ).toBe("override");
    expect(
      partnerQuoteAction({
        ...priced,
        status: "needs_review",
        reviewReason: "image_quality",
      }),
    ).toBe("unavailable");
    expect(partnerQuoteAction({ ...priced, billablePages: 0, totalCents: 0 })).toBe("unavailable");
  });

  it("returns the public order shape and adds qa on the detail read", () => {
    const body = toPartnerOrder({ order: order(), paymentStatus: "paid", detail: false, qa: null });
    expect(body).toEqual({
      id: "order-1",
      status: "quoted",
      service: "translation",
      sourceLanguage: "es",
      targetLanguage: "en",
      externalRef: "crm-1842",
      billablePages: 3,
      unitPriceCents: 995,
      totalCents: 2985,
      currency: "usd",
      payment: { status: "paid" },
    });
    const detail = toPartnerOrder({
      order: order({ status: "needs_review", reviewReason: EVALUATION_REVIEW_REASON, serviceType: "evaluation" }),
      paymentStatus: null,
      detail: true,
      qa: null,
    });
    expect(detail.reviewReason).toBe("Credential evaluation is reviewed by staff.");
    expect(detail.qa).toBeNull();
    expect(detail.payment).toBeNull();
  });
});
