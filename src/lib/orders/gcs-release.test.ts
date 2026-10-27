import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import { confirmFreeGcsQuote, gcsTranslationContinue, settleGcsAnalysis } from "./gcs-release";
import { decideQuote } from "./quote";
import type { Db } from "./storage";

const handle = {} as Db;

const imageHold = decideQuote({
  billableUnits: [1],
  pageNeedsReview: [true],
  language: "ar",
  confidence: 0.2,
  detectionAvailable: true,
  languagesDisagree: false,
  imageQuality: true,
});

describe("settleGcsAnalysis", () => {
  it("quotes a GCS page even when image quality and language confidence would hold it", () => {
    expect(imageHold.status).toBe("needs_review");
    expect(imageHold.reviewReason).toBe("image_quality");
    expect(
      settleGcsAnalysis({
        pageCount: 1,
        decision: imageHold,
        sourceLanguage: "auto",
        detectedSource: "ar",
        languages: ["ar"],
      }),
    ).toEqual({ status: "quoted", reviewReason: null, sourceLanguage: "ar" });
    expect(
      settleGcsAnalysis({
        pageCount: 1,
        decision: imageHold,
        sourceLanguage: null,
        detectedSource: null,
        languages: [],
      }),
    ).toEqual({ status: "quoted", reviewReason: null, sourceLanguage: "auto" });
    expect(
      settleGcsAnalysis({
        pageCount: 1,
        decision: imageHold,
        sourceLanguage: "ar",
        detectedSource: "fr",
        languages: ["es"],
      }).sourceLanguage,
    ).toBe("ar");
  });

  it("keeps a hold when the upload produced no pages", () => {
    expect(
      settleGcsAnalysis({
        pageCount: 0,
        decision: imageHold,
        sourceLanguage: null,
        detectedSource: null,
        languages: [],
      }),
    ).toEqual({ status: "needs_review", reviewReason: "image_quality", sourceLanguage: "auto" });
  });
});

describe("gcsTranslationContinue", () => {
  it("sends an image_quality hold with a page straight into translation", () => {
    expect(
      gcsTranslationContinue({
        status: "needs_review",
        sourceLanguage: null,
        billablePages: 1,
        progress: { pagesRead: 1, pagesTotal: 1 },
      }),
    ).toEqual({ ready: true, sourceLanguage: "auto" });
    expect(
      gcsTranslationContinue({
        status: "quoted",
        sourceLanguage: "ar",
        billablePages: 1,
        progress: { pagesRead: 1, pagesTotal: 1 },
      }),
    ).toEqual({ ready: true, sourceLanguage: "ar" });
    expect(
      gcsTranslationContinue({
        status: "needs_review",
        sourceLanguage: null,
        billablePages: null,
        progress: { pagesRead: 0, pagesTotal: 0 },
      }).ready,
    ).toBe(false);
  });
});

describe("confirmFreeGcsQuote", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("clears image_quality and confirms the free quote", async () => {
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    await confirmFreeGcsQuote(handle, "order-1", {
      sourceLanguage: "ar",
      quoted: true,
      pagesRead: 1,
      pagesTotal: 1,
    });
    expect(update).toHaveBeenCalledWith(
      handle,
      "order-1",
      expect.objectContaining({
        status: "confirmed",
        source_language: "ar",
        language_confirmed: true,
        review_reason: null,
        total_cents: 0,
        translation_cents: 0,
        unit_price_cents: 0,
      }),
    );
  });
});
