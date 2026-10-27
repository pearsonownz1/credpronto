import { beforeEach, describe, expect, it, vi } from "vitest";
import { releaseGcsAnalysisHold } from "./analysis";
import * as db from "./db";
import * as gcsRelease from "./gcs-release";
import { continueFreeGcsOrder, processOrder } from "./pipeline";
import { decideQuote } from "./quote";
import * as storage from "./storage";
import type { Db } from "./storage";
import * as translation from "./translation";
import type { OrderRecord } from "./types";

const handle = {} as Db;

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-gcs-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "translation",
    status: "needs_review",
    sourceLanguage: "ar",
    targetLanguage: "en",
    languageConfirmed: false,
    billablePages: 1,
    unitPriceCents: 0,
    totalCents: 0,
    currency: "usd",
    etaAt: null,
    reviewReason: "image_quality",
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
    translationCents: 0,
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
    createdAt: "2026-10-27T00:00:00.000Z",
    updatedAt: "2026-10-27T00:00:00.000Z",
    paidAt: null,
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
    brand: "gcs",
    ...patch,
  };
}

describe("releaseGcsAnalysisHold", () => {
  it("lets GCS orders with a source language proceed past image_quality holds", () => {
    const held = decideQuote({
      billableUnits: [1],
      pageNeedsReview: [true],
      language: "ar",
      confidence: 0.4,
      detectionAvailable: true,
      languagesDisagree: false,
      imageQuality: true,
    });
    expect(held.status).toBe("needs_review");
    expect(held.reviewReason).toBe("image_quality");

    const released = releaseGcsAnalysisHold(held, "ar");
    expect(released).toMatchObject({ status: "quoted", reviewReason: null, etaHours: 1 });
    expect(releaseGcsAnalysisHold(held, null).status).toBe("needs_review");
    expect(releaseGcsAnalysisHold(held, "  ").status).toBe("needs_review");
  });

  it("also clears low-confidence language holds when a language is known", () => {
    const held = decideQuote({
      billableUnits: [1],
      pageNeedsReview: [false],
      language: "ar",
      confidence: 0.2,
      detectionAvailable: true,
      languagesDisagree: false,
    });
    expect(held.status).toBe("needs_review");
    expect(releaseGcsAnalysisHold(held, "ar").status).toBe("quoted");
  });
});

describe("continueFreeGcsOrder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(translation, "translateOrder").mockResolvedValue(undefined);
    vi.spyOn(gcsRelease, "confirmFreeGcsQuote").mockResolvedValue(undefined);
  });

  it("confirms and translates a quoted GCS order", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order({ status: "quoted", reviewReason: null }));

    await continueFreeGcsOrder(handle, "order-gcs-1", "tok-1");

    expect(gcsRelease.confirmFreeGcsQuote).toHaveBeenCalledWith(
      handle,
      "order-gcs-1",
      expect.objectContaining({ sourceLanguage: "ar", quoted: true }),
    );
    expect(translation.translateOrder).toHaveBeenCalledWith(handle, "order-gcs-1", "tok-1");
  });

  it("confirms and translates a needs_review GCS order when the language is known", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({ status: "needs_review", reviewReason: "image_quality", sourceLanguage: "ar" }),
    );

    await continueFreeGcsOrder(handle, "order-gcs-1", "tok-nadine");

    expect(gcsRelease.confirmFreeGcsQuote).toHaveBeenCalledWith(
      handle,
      "order-gcs-1",
      expect.objectContaining({ sourceLanguage: "ar", quoted: true }),
    );
    expect(translation.translateOrder).toHaveBeenCalledWith(handle, "order-gcs-1", "tok-nadine");
  });

  it("does not translate a needs_review GCS order without a source language", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(
      order({ status: "needs_review", sourceLanguage: null, reviewReason: "image_quality" }),
    );

    await continueFreeGcsOrder(handle, "order-gcs-1", "tok-1");

    expect(gcsRelease.confirmFreeGcsQuote).toHaveBeenCalledWith(
      handle,
      "order-gcs-1",
      expect.objectContaining({ quoted: false, sourceLanguage: null }),
    );
    expect(translation.translateOrder).not.toHaveBeenCalled();
  });

  it("ignores non-GCS orders", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order({ brand: "credpronto", status: "quoted" }));

    await continueFreeGcsOrder(handle, "order-gcs-1", "tok-1");

    expect(gcsRelease.confirmFreeGcsQuote).not.toHaveBeenCalled();
    expect(translation.translateOrder).not.toHaveBeenCalled();
  });
});

describe("processOrder GCS needs_review recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "serviceDb").mockReturnValue(handle);
    vi.spyOn(translation, "translateOrder").mockResolvedValue(undefined);
    vi.spyOn(gcsRelease, "confirmFreeGcsQuote").mockResolvedValue(undefined);
  });

  it("recovers a stuck GCS needs_review order and starts translation", async () => {
    const stuck = order({
      status: "needs_review",
      brand: "gcs",
      sourceLanguage: "ar",
      reviewReason: "image_quality",
      languageConfirmed: false,
    });
    vi.spyOn(db, "getOrderById").mockResolvedValue(stuck);

    await processOrder("order-gcs-1", "tok-nadine");

    expect(gcsRelease.confirmFreeGcsQuote).toHaveBeenCalledWith(
      handle,
      "order-gcs-1",
      expect.objectContaining({ quoted: true, sourceLanguage: "ar" }),
    );
    expect(translation.translateOrder).toHaveBeenCalledWith(handle, "order-gcs-1", "tok-nadine");
  });
});
