import { describe, expect, it } from "vitest";
import { orderAwaitingAnalysis } from "./analysis";
import { UNIT_PRICE_CENTS } from "./constants";
import { decideQuote } from "./quote";
import { EVALUATION_REVIEW_REASON, apiOrderBeforeQuote, partnerQuoteAction, quotedForCharge, toPartnerOrder } from "./partner";
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
    includeTranslation: false,
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
    updatedAt: "2026-10-12T00:00:00.000Z",
    progress: { step: "done", pagesRead: 3, pagesTotal: 3 },
    ...patch,
  };
}

describe("partner orders", () => {
  it("quotes an API upload on the same unconfirmed draft pass as the website", () => {
    const before = apiOrderBeforeQuote("fr");
    expect(before).toEqual({ sourceLanguage: "fr", languageConfirmed: false });
    expect(orderAwaitingAnalysis({ languageConfirmed: before.languageConfirmed, status: "draft" })).toBe(true);
    // Confirming the language before analysis returns immediately and the order stays unpriced.
    expect(orderAwaitingAnalysis({ languageConfirmed: true, status: "draft" })).toBe(false);

    const decision = decideQuote({
      billableUnits: [1],
      pageNeedsReview: [false],
      language: "fr",
      confidence: 0.95,
      detectionAvailable: true,
      languagesDisagree: false,
    });
    expect(decision).toMatchObject({ status: "quoted", billablePages: 1, totalCents: UNIT_PRICE_CENTS, reviewReason: null });
    expect(
      partnerQuoteAction({
        status: decision.status,
        billablePages: decision.billablePages,
        totalCents: decision.totalCents,
        reviewReason: decision.reviewReason,
        sourceLanguage: before.sourceLanguage,
        service: "translation",
      }),
    ).toBe("use");
    expect(quotedForCharge({ status: decision.status, totalCents: decision.totalCents })).toBe(true);
    expect(quotedForCharge({ status: "draft", totalCents: null })).toBe(false);
  });

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
