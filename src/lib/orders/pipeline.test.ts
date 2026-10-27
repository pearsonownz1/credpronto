import { beforeEach, describe, expect, it, vi } from "vitest";
import * as analysis from "./analysis";
import * as db from "./db";
import * as dispatch from "./evaluation-dispatch";
import * as gcsRelease from "./gcs-release";
import { loadCustomerOrder, processOrder } from "./pipeline";
import * as storage from "./storage";
import type { Db } from "./storage";
import * as translation from "./translation";
import type { DocumentRecord, FinalCorrectionRecord, OrderRecord, PageRecord } from "./types";

const handle = {} as Db;

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "translation",
    status: "delivered",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 1,
    unitPriceCents: 995,
    totalCents: 995,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: "order-1/certified-translation-v1.pdf",
    certificationPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
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
    paidAt: "2026-10-12T00:05:00.000Z",
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
    ...patch,
  };
}

function correction(patch: Partial<FinalCorrectionRecord> = {}): FinalCorrectionRecord {
  return {
    id: "corr-1",
    orderId: "order-1",
    text: "Fix the name.",
    status: "open",
    finalPath: null,
    finalVersion: null,
    claimedAt: null,
    fixedAt: null,
    createdAt: "2026-10-23T15:00:00.000Z",
    ...patch,
  };
}

describe("loadCustomerOrder final correction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, "listDocuments").mockResolvedValue([]);
    vi.spyOn(db, "listPages").mockResolvedValue([]);
    vi.spyOn(db, "listConfirmations").mockResolvedValue([]);
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue(null);
    vi.spyOn(db, "latestPayment").mockResolvedValue(null);
    vi.spyOn(db, "getDelivery").mockResolvedValue(null);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([]);
    vi.spyOn(db, "earliestReadyPreviewAt").mockResolvedValue(null);
    vi.spyOn(db, "listTranslations").mockResolvedValue([]);
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);
    vi.spyOn(db, "listCorrections").mockResolvedValue([]);
  });

  it("is null when the order has no final-file correction", async () => {
    vi.spyOn(db, "getFinalCorrection").mockResolvedValue(null);
    const body = await loadCustomerOrder(handle, order());
    expect(body.finalCorrection).toBeNull();
    expect(db.getFinalCorrection).toHaveBeenCalledWith(handle, "order-1");
  });

  it("returns the stored request as id, status, createdAt, and fixedAt", async () => {
    vi.spyOn(db, "getFinalCorrection").mockResolvedValue(
      correction({
        status: "fixed",
        finalPath: "order-1/corrected-final-v2.pdf",
        finalVersion: 2,
        claimedAt: "2026-10-23T16:00:00.000Z",
        fixedAt: "2026-10-23T17:00:00.000Z",
      }),
    );
    const body = await loadCustomerOrder(handle, order());
    expect(body.finalCorrection).toEqual({
      id: "corr-1",
      status: "fixed",
      createdAt: "2026-10-23T15:00:00.000Z",
      fixedAt: "2026-10-23T17:00:00.000Z",
    });
    expect(JSON.stringify(body.finalCorrection)).not.toMatch(/Fix the name|corrected-final|claimedAt/);
  });
});

describe("processOrder paid evaluations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "serviceDb").mockReturnValue(handle);
    vi.spyOn(dispatch, "ensurePaidEvaluationReports").mockResolvedValue({
      status: "unchanged",
      generated: [],
      pending: [],
      failures: [],
    });
    vi.spyOn(translation, "translateOrder").mockResolvedValue(undefined);
    vi.spyOn(analysis, "analyzeOrder").mockResolvedValue(undefined);
  });

  it("generates evaluations for a paid translation bundle and does not translate again", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        status: "paid",
        orderType: "evaluation",
        serviceType: "evaluation",
        service: null,
        services: ["translation", "diploma", "course_by_course"],
        includeTranslation: true,
        degreeCount: 1,
        finalTranslationPath: "order-1/certified-translation-v1.pdf",
        certificationPath: "order-1/certified-translation-v1.pdf",
        evaluationResult: null,
        evaluationResults: null,
      }),
    );

    await processOrder("order-1");

    expect(dispatch.ensurePaidEvaluationReports).toHaveBeenCalledWith(handle, "order-1");
    expect(translation.translateOrder).not.toHaveBeenCalled();
    expect(analysis.analyzeOrder).not.toHaveBeenCalled();
  });

  it("generates a paid single diploma evaluation and does not translate it", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        status: "paid",
        orderType: "evaluation",
        serviceType: "evaluation",
        service: "diploma",
        includeTranslation: false,
        degreeCount: 1,
        finalTranslationPath: null,
        certificationPath: null,
      }),
    );

    await processOrder("order-1");

    expect(dispatch.ensurePaidEvaluationReports).toHaveBeenCalledWith(handle, "order-1");
    expect(translation.translateOrder).not.toHaveBeenCalled();
  });

  it("analyzes an unpaid diploma-only draft so the evaluation is built on upload", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        status: "draft",
        paidAt: null,
        orderType: "evaluation",
        serviceType: "evaluation",
        service: "diploma",
        includeTranslation: false,
        degreeCount: 1,
        finalTranslationPath: null,
        certificationPath: null,
      }),
    );

    await processOrder("order-1");

    expect(dispatch.ensurePaidEvaluationReports).not.toHaveBeenCalled();
    expect(analysis.analyzeOrder).toHaveBeenCalledWith(handle, "order-1", null);
    expect(translation.translateOrder).not.toHaveBeenCalled();
  });

  it("analyzes an unpaid translation bundle and does not generate paid evaluation files yet", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        status: "draft",
        paidAt: null,
        orderType: "evaluation",
        serviceType: "evaluation",
        service: null,
        services: ["translation", "diploma", "course_by_course"],
        includeTranslation: true,
        degreeCount: 1,
        finalTranslationPath: null,
        certificationPath: null,
      }),
    );

    await processOrder("order-1", "token-1");

    expect(dispatch.ensurePaidEvaluationReports).not.toHaveBeenCalled();
    expect(analysis.analyzeOrder).toHaveBeenCalledWith(handle, "order-1", "token-1");
    expect(translation.translateOrder).not.toHaveBeenCalled();
  });
});

function storedPage(patch: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "page-1",
    documentId: "doc-1",
    pageNumber: 1,
    wordCount: 0,
    billableUnits: 0,
    billingBasis: "words",
    ocrText: "",
    needsReview: false,
    widthPt: 612,
    heightPt: 792,
    uploadPage: 1,
    logicalPage: 1,
    orderHint: null,
    qualityScore: null,
    qualityFlags: [],
    qualityMessage: null,
    ...patch,
  };
}

describe("processOrder stuck GCS review", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "serviceDb").mockReturnValue(handle);
    vi.spyOn(dispatch, "ensurePaidEvaluationReports").mockResolvedValue({
      status: "unchanged",
      generated: [],
      pending: [],
      failures: [],
    });
    vi.spyOn(translation, "translateOrder").mockResolvedValue(undefined);
    vi.spyOn(analysis, "analyzeOrder").mockResolvedValue(undefined);
    vi.spyOn(gcsRelease, "confirmFreeGcsQuote").mockResolvedValue(undefined);
    vi.spyOn(db, "unskipBlankPage").mockResolvedValue(undefined);
    vi.spyOn(db, "listDocuments").mockResolvedValue([{ id: "doc-1" } as DocumentRecord]);
  });

  it("unskips a readable Arabic blank page, confirms the quote, and translates", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({
        brand: "gcs",
        status: "needs_review",
        sourceLanguage: "ar",
        reviewReason: "image_quality",
        paidAt: null,
        totalCents: 0,
        finalTranslationPath: null,
      }),
    );
    vi.spyOn(db, "listPages").mockResolvedValue([
      storedPage({
        id: "arabic",
        skip: true,
        skipReason: "blank",
        ocrText: "شهادة طلاق رسمية بين الطرفين وفق أحكام القانون",
      }),
      storedPage({ id: "empty", pageNumber: 2, skip: true, skipReason: "blank", ocrText: " \n" }),
      storedPage({
        id: "english",
        pageNumber: 3,
        skip: true,
        skipReason: "english",
        ocrText: "This page is already written in English.",
      }),
    ]);

    await processOrder("order-1", "token-1");

    expect(db.unskipBlankPage).toHaveBeenCalledTimes(1);
    expect(db.unskipBlankPage).toHaveBeenCalledWith(handle, "arabic");
    expect(gcsRelease.confirmFreeGcsQuote).toHaveBeenCalledWith(handle, "order-1", {
      sourceLanguage: "ar",
      quoted: true,
      pagesRead: 1,
      pagesTotal: 1,
    });
    expect(translation.translateOrder).toHaveBeenCalledWith(handle, "order-1", "token-1");
    expect(analysis.analyzeOrder).not.toHaveBeenCalled();
  });

  it("leaves a non-GCS needs_review order on the review queue", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({ status: "needs_review", sourceLanguage: "ar", reviewReason: "image_quality", paidAt: null }),
    );

    await processOrder("order-1", "token-1");

    expect(db.unskipBlankPage).not.toHaveBeenCalled();
    expect(gcsRelease.confirmFreeGcsQuote).not.toHaveBeenCalled();
    expect(translation.translateOrder).not.toHaveBeenCalled();
  });
});
