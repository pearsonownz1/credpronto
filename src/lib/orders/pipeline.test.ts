import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import { loadCustomerOrder } from "./pipeline";
import type { Db } from "./storage";
import type { FinalCorrectionRecord, OrderRecord } from "./types";

const handle = {} as Db;

function order(): OrderRecord {
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
