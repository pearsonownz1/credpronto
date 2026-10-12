import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";
import { readOrderPatch, readTargetLanguage, updateOrderTarget } from "./customer";
import * as db from "./db";
import * as evaluation from "./evaluation";
import * as storage from "./storage";
import * as translation from "./translation";
import type { OrderRecord, PageRecord } from "./types";

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

describe("readOrderPatch", () => {
  it("accepts a target, a skip list, or both", () => {
    expect(readOrderPatch({ targetLanguage: "es" })).toEqual({ targetLanguage: "es", skipPages: null });
    expect(readOrderPatch({ skipPages: [2, 9] })).toEqual({ targetLanguage: null, skipPages: [2, 9] });
    expect(readOrderPatch({ targetLanguage: "es", skipPages: [] })).toEqual({
      targetLanguage: "es",
      skipPages: [],
    });
    expect(() => readOrderPatch({})).toThrow(/targetLanguage or skipPages/);
    expect(() => readOrderPatch({ skipPages: [0] })).toThrow(/page numbers/);
    expect(() => readOrderPatch({ skipPages: [1, 1] })).toThrow(/page numbers/);
  });
});

function storedPage(patch: Partial<PageRecord> = {}): PageRecord {
  return {
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
    skip: false,
    skipReason: null,
    ...patch,
  };
}

describe("updateOrderTarget", () => {
  let pages: PageRecord[];

  beforeEach(() => {
    vi.restoreAllMocks();
    pages = [storedPage()];
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
    vi.spyOn(db, "listPages").mockImplementation(async () => pages.map((page) => ({ ...page })));
    vi.spyOn(db, "updatePageQuote").mockImplementation(async (_db, id, patch) => {
      const page = pages.find((item) => item.id === id);
      if (!page) return;
      page.wordCount = patch.wordCount;
      page.billableUnits = patch.billableUnits;
      page.billingBasis = patch.billingBasis;
      page.skip = patch.skip;
      page.skipReason = patch.skipReason;
    });
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
        billable_pages: 1,
        total_cents: 995,
      }),
    );
    expect(translation.translateOrder).not.toHaveBeenCalled();
    expect(result.status).toBe("quoted");
    expect(result.targetLanguage).toBe("es");
    expect(result.reviewReason).toBeNull();
    expect(result.lineItems).toEqual([
      expect.objectContaining({
        kind: "page",
        pageIndex: 1,
        billableUnits: 1,
        skip: false,
        skipReason: null,
        amountCents: 995,
      }),
    ]);
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
        translationCents: 995,
        totalCents: 2990,
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
        translation_cents: 995,
        total_cents: 2990,
      }),
    );
    expect(evaluation.retryEvaluation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetLanguage: "es", sourceLanguage: "en" }),
      "en",
    );
    expect(result.lineItems.map((item) => item.kind)).toEqual(["evaluation", "translation"]);
    expect(result.translationCents).toBe(995);
  });

  it("rejects a target equal to the source, an unsupported code, and a paid order", async () => {
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(order());
    await expect(updateOrderTarget(token, { targetLanguage: "en" })).rejects.toThrow(/different from the source/);
    await expect(updateOrderTarget(token, { targetLanguage: "xx" })).rejects.toThrow(/supported target language/);

    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(order({ status: "paid" }));
    await expect(updateOrderTarget(token, { targetLanguage: "es" })).rejects.toThrow(/already paid/);
    expect(db.updateOrder).not.toHaveBeenCalled();
  });

  it("auto-skips English pages and a DHL label on a Chinese order, then replaces that list", async () => {
    const chinese =
      "教育部学历证书电子注册备案表 验证报告 姓名张伟 性别男 出生日期一九九八年六月一日 院校北京大学 层次本科 专业计算机科学与技术 学号2019001234 证书编号120190001234 学信网CHESICC";
    const english =
      "Verification Report of China Higher Education Student's Academic Transcript. This is to certify that the following information is true and correct. Name Zhang Wei. Date of birth 1 June 1998. Institution Peking University. The Ministry of Education issued this verification report.";
    const label = "DHL EXPRESS WAYBILL\nSHIP TO NEW YORK\nTRACKING 1234567890";
    const texts = [chinese, english, chinese, english, chinese, english, chinese, english, label];
    pages = texts.map((text, index) =>
      storedPage({
        id: `page-${index + 1}`,
        pageNumber: index + 1,
        uploadPage: index + 1,
        ocrText: text,
        wordCount: null,
        billableUnits: null,
        billingBasis: null,
      }),
    );
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      {
        id: "doc-1",
        orderId: "order-1",
        originalPath: "originals/doc",
        filename: "chesicc.pdf",
        mime: "application/pdf",
        size: 10,
        pageCount: 9,
        status: "ready",
        detectedLanguage: "zh",
        confidence: 0.99,
        position: 1,
        appliedPosition: 1,
      },
    ]);
    const current = order({
      status: "quoted",
      sourceLanguage: "zh",
      targetLanguage: "en",
      reviewReason: null,
      billablePages: null,
      totalCents: null,
    });
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(current);
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        status: "quoted",
        sourceLanguage: "zh",
        targetLanguage: "en",
        reviewReason: null,
        billablePages: 4,
        totalCents: 3980,
      }),
    );

    const quoted = await updateOrderTarget(token, { targetLanguage: "en" });
    expect(quoted.lineItems).toHaveLength(9);
    expect(quoted.lineItems.filter((item) => item.skip)).toHaveLength(5);
    expect(quoted.lineItems.reduce((sum, item) => sum + (item.billableUnits ?? 0), 0)).toBe(4);
    expect(quoted.lineItems.map((item) => item.skipReason)).toEqual([
      null,
      "target_language",
      null,
      "target_language",
      null,
      "target_language",
      null,
      "target_language",
      "not_document",
    ]);
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({ billable_pages: 4, total_cents: 3980 }),
    );

    vi.mocked(db.updateOrder).mockClear();
    const kept = await updateOrderTarget(token, { skipPages: [4, 6, 8, 9] });
    expect(kept.lineItems.filter((item) => item.skip)).toHaveLength(4);
    expect(kept.lineItems.reduce((sum, item) => sum + (item.billableUnits ?? 0), 0)).toBe(5);
    expect(kept.lineItems[1]).toEqual(expect.objectContaining({ pageIndex: 2, skip: false, billableUnits: 1 }));
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({ billable_pages: 5, total_cents: 4975 }),
    );
  });
});
