import { describe, expect, it } from "vitest";
import { orderAwaitingAnalysis } from "./analysis";
import { UNIT_PRICE_CENTS } from "./constants";
import { HttpError } from "./errors";
import { decideQuote } from "./quote";
import {
  EVALUATION_REVIEW_REASON,
  apiOrderBeforeQuote,
  partnerQuoteAction,
  quotedForCharge,
  readPartnerAddonBody,
  toPartnerOrder,
} from "./partner";
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
    edgeMatchMethod: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    paidAt: null,
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
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
      expeditedUnit: "order",
      totalCents: 2985,
      currency: "usd",
      payment: { status: "paid" },
      progress: { step: "done", pagesRead: 3, pagesTotal: 3 },
      paidAt: null,
      fulfillment: null,
      delayed: false,
    });
    expect(body.totalCents).toBe(body.billablePages! * body.unitPriceCents);
    const detail = toPartnerOrder({
      order: order({ status: "needs_review", reviewReason: EVALUATION_REVIEW_REASON, serviceType: "evaluation" }),
      paymentStatus: null,
      detail: true,
      qa: null,
    });
    expect(detail.reviewReason).toBe("Credential evaluation is reviewed by staff.");
    expect(detail.qa).toBeNull();
    expect(detail.payment).toBeNull();
    expect(detail.progress).toEqual({ step: "done", pagesRead: 3, pagesTotal: 3 });
    expect(detail.delayed).toBe(false);
  });

  it("reports translation progress and a delayed preview without internal fields", () => {
    const body = toPartnerOrder({
      order: order({
        status: "processing",
        updatedAt: "2026-10-12T00:00:00.000Z",
        reviewReason: "Language detection confidence is low (0.20).",
        pageOrderBasis: "logical",
        pageOrder: {
          basis: "logical",
          pages: [
            {
              documentId: "doc-1",
              uploadPosition: 1,
              appliedPosition: 1,
              uploadPage: 1,
              appliedPage: 1,
              logicalPage: 1,
              hint: "page 1/2",
              confidence: 0.93,
            },
          ],
        },
        edgeCredentialId: "cred-1",
        edgeMatchMethod: "base",
        progress: {
          step: "translating",
          pagesRead: 12,
          pagesTotal: 12,
          pagesDone: 4,
          pagesTranslateTotal: 9,
          retries: 2,
        },
      }),
      paymentStatus: "paid",
      detail: true,
      qa: null,
      previewVersion: null,
      now: Date.parse("2026-10-12T00:20:00.000Z"),
    });
    expect(body.progress).toEqual({
      step: "translating",
      pagesRead: 12,
      pagesTotal: 12,
      pagesDone: 4,
      pagesTranslateTotal: 9,
    });
    expect(body.progress).not.toHaveProperty("retries");
    expect(body.delayed).toBe(true);
    expect(body.reviewReason).toBeNull();
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/retries|equivalencyBasis|edgeMatch|edge_|"confidence"|"basis"/);
    expect(json).not.toMatch(/\bEDGE\b/);

    const ready = toPartnerOrder({
      order: order({
        status: "processing",
        updatedAt: "2026-10-12T00:00:00.000Z",
        progress: { step: "translating", pagesRead: 12, pagesTotal: 12, pagesDone: 9, pagesTranslateTotal: 9 },
      }),
      paymentStatus: "paid",
      detail: false,
      qa: null,
      previewVersion: 1,
      now: Date.parse("2026-10-12T00:20:00.000Z"),
    });
    expect(ready.delayed).toBe(false);
  });

  it("rejects expedited on a translation API order and accepts it for an evaluation", () => {
    const translation = new FormData();
    translation.set("addons", JSON.stringify(["expedited"]));
    expect(() => readPartnerAddonBody(translation, "translation")).toThrow(HttpError);
    expect(() => readPartnerAddonBody(translation, "translation")).toThrow("Expedited is no longer offered");

    const diploma = new FormData();
    diploma.set("addons", JSON.stringify(["notarization", "expedited"]));
    expect(readPartnerAddonBody(diploma, "evaluation")).toMatchObject({
      addons: ["notarization", "expedited"],
    });

    const course = new FormData();
    course.append("addons", "expedited");
    expect(readPartnerAddonBody(course, "evaluation")?.addons).toEqual(["expedited"]);
    const quoted = toPartnerOrder({
      order: order({ serviceType: "evaluation", service: "diploma", totalCents: 1995 }),
      paymentStatus: null,
      detail: false,
      qa: null,
    });
    expect(quoted.expeditedUnit).toBe("order");
    expect(quoted.totalCents).toBe(1995);
    expect(() => readPartnerAddonBody(course, "translation")).toThrow("Expedited is no longer offered");
    expect(readPartnerAddonBody(new FormData(), "translation")).toBeNull();
  });
});
