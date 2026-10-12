import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";
import { readTargetLanguage, updateOrderTarget } from "./customer";
import * as db from "./db";
import * as evaluation from "./evaluation";
import * as storage from "./storage";
import * as translation from "./translation";
import type { OrderRecord } from "./types";

const token = "a".repeat(43);

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "translation",
    status: "needs_review",
    sourceLanguage: "en",
    targetLanguage: "en",
    languageConfirmed: false,
    billablePages: 3,
    unitPriceCents: 995,
    totalCents: 2985,
    currency: "usd",
    etaAt: null,
    reviewReason: "same_language",
    combinedOriginalPath: null,
    finalTranslationPath: null,
    certificationPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
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

describe("readTargetLanguage", () => {
  it("accepts a supported language and rejects the source or an unknown code", () => {
    expect(readTargetLanguage({ targetLanguage: "Spanish" })).toBe("es");
    expect(readTargetLanguage({ targetLanguage: "en-US" })).toBe("en");
    expect(() => readTargetLanguage({})).toThrow(HttpError);
    expect(() => readTargetLanguage({ targetLanguage: "klingon" })).toThrow(/supported target language/);
  });
});

describe("updateOrderTarget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as db.Db);
    vi.spyOn(db, "settledPayment").mockResolvedValue(null);
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      {
        id: "doc-1",
        orderId: "order-1",
        originalPath: "originals/doc",
        filename: "cv.pdf",
        mime: "application/pdf",
        size: 10,
        pageCount: 3,
        status: "ready",
        detectedLanguage: "en",
        confidence: 0.99,
        position: 1,
        appliedPosition: 1,
      },
    ]);
    vi.spyOn(db, "listPages").mockResolvedValue([
      {
        id: "page-1",
        documentId: "doc-1",
        pageNumber: 1,
        wordCount: 400,
        billableUnits: 3,
        billingBasis: "words",
        ocrText: "English text",
        needsReview: false,
        widthPt: 612,
        heightPt: 792,
        uploadPage: 1,
        logicalPage: null,
        orderHint: null,
        qualityScore: 0.9,
        qualityFlags: [],
        qualityMessage: null,
      },
    ]);
    vi.spyOn(db, "listConfirmations").mockResolvedValue([]);
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue(null);
    vi.spyOn(db, "latestPayment").mockResolvedValue(null);
    vi.spyOn(db, "getDelivery").mockResolvedValue(null);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([]);
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    vi.spyOn(translation, "translateOrder").mockResolvedValue(undefined);
    vi.spyOn(evaluation, "retryEvaluation").mockResolvedValue(undefined);
  });

  it("re-quotes an English order into the chosen target and clears same_language", async () => {
    const current = order();
    const saved = order({ status: "quoted", targetLanguage: "es", reviewReason: null });
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(current);
    vi.spyOn(db, "getOrderById").mockResolvedValue(saved);

    const result = await updateOrderTarget(token, { targetLanguage: "es" });

    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        target_language: "es",
        status: "quoted",
        review_reason: null,
        total_cents: 2985,
      }),
    );
    expect(translation.translateOrder).not.toHaveBeenCalled();
    expect(result.status).toBe("quoted");
    expect(result.targetLanguage).toBe("es");
    expect(result.reviewReason).toBeNull();
    expect(result.lineItems).toEqual([]);
  });

  it("rebuilds a confirmed translation preview in the new target language", async () => {
    const current = order({ status: "preview_ready", languageConfirmed: true, reviewReason: null });
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(current);
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({ status: "preview_ready", targetLanguage: "es", languageConfirmed: true, reviewReason: null }),
    );

    await updateOrderTarget(token, { targetLanguage: "es" });

    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({ target_language: "es", status: "confirmed", review_reason: null }),
    );
    expect(translation.translateOrder).toHaveBeenCalledWith(expect.anything(), "order-1", token);
  });

  it("re-quotes an English evaluation and rebuilds its preview", async () => {
    const current = order({
      orderType: "evaluation",
      serviceType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
      billablePages: 2,
    });
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(current);
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        ...current,
        targetLanguage: "es",
        reviewReason: null,
        translationCents: 1990,
        totalCents: 3985,
        status: "preview_ready",
      }),
    );

    const result = await updateOrderTarget(token, { targetLanguage: "es" });

    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        target_language: "es",
        review_reason: null,
        evaluation_cents: 1995,
        translation_cents: 1990,
        total_cents: 3985,
      }),
    );
    expect(evaluation.retryEvaluation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetLanguage: "es", sourceLanguage: "en" }),
      "en",
    );
    expect(result.lineItems.map((item) => item.kind)).toEqual(["evaluation", "translation"]);
    expect(result.translationCents).toBe(1990);
  });

  it("rejects a target equal to the source, an unsupported code, and a paid order", async () => {
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(order());
    await expect(updateOrderTarget(token, { targetLanguage: "en" })).rejects.toThrow(/different from the source/);
    await expect(updateOrderTarget(token, { targetLanguage: "xx" })).rejects.toThrow(/supported target language/);

    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(order({ status: "paid" }));
    await expect(updateOrderTarget(token, { targetLanguage: "es" })).rejects.toThrow(/already paid/);
    expect(db.updateOrder).not.toHaveBeenCalled();
  });
});
