import { beforeEach, describe, expect, it, vi } from "vitest";
import * as analysis from "./analysis";
import * as db from "./db";
import * as dispatch from "./evaluation-dispatch";
import { loadCustomerOrder, processOrder } from "./pipeline";
import * as storage from "./storage";
import type { Db } from "./storage";
import * as translation from "./translation";
import type { FinalCorrectionRecord, OrderRecord } from "./types";

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

  it("leaves an unpaid diploma-only draft alone", async () => {
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
    expect(analysis.analyzeOrder).not.toHaveBeenCalled();
    expect(translation.translateOrder).not.toHaveBeenCalled();
  });

  it("analyzes an unpaid translation bundle and does not generate evaluations", async () => {
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
