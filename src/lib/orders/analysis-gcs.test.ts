import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeOrder, CUE_INSTRUCTIONS } from "./analysis";
import * as ai from "./ai";
import * as db from "./db";
import * as storage from "./storage";
import * as translationJobs from "./translation-jobs";
import type { DocumentRecord, OrderRecord } from "./types";
import * as webhooks from "./webhook-delivery";

const orderId = "28492f38-1111-4111-8111-111111111111";
const dbHandle = {} as db.Db;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const certificate = [
  "جمهورية",
  "السودان",
  "السلطة",
  "القضائية",
  "وثيقة",
  "طلاق",
  "المحكمة",
  "الخرطوم",
  "الزوج",
  "الزوجة",
  "التاريخ",
  "الشاهد",
  "الختم",
  "القاضي",
  "التوقيع",
].join(" ");

function photoOrder(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    status: "draft",
    languageConfirmed: false,
    service: null,
    degreeCount: null,
    targetLanguage: "en",
    sourceLanguage: null,
    brand: "gcs",
    ...patch,
  } as OrderRecord;
}

describe("GCS photo analysis", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, "claimDocuments").mockResolvedValue([
      {
        id: "doc-1",
        orderId,
        originalPath: `${orderId}/divorce.png`,
        filename: "divorce.png",
        mime: "image/png",
        position: 1,
      } as DocumentRecord,
    ]);
    vi.spyOn(db, "setOrderProgress").mockResolvedValue(undefined);
    vi.spyOn(db, "replacePages").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDocument").mockResolvedValue(undefined);
    vi.spyOn(db, "replaceExtractedConfirmations").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "hasEvent").mockResolvedValue(true);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "markDocuments").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(PNG);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(translationJobs, "queueEarlyTranslation").mockResolvedValue(undefined);
  });

  it("tells the reader not to flag a legible phone photo of a handwritten certificate", () => {
    expect(CUE_INSTRUCTIONS).toContain("phone photo");
    expect(CUE_INSTRUCTIONS).toContain("handwritten");
    expect(CUE_INSTRUCTIONS).toContain("too_dark");
    expect(CUE_INSTRUCTIONS).toContain("unreadable_fields");
    expect(CUE_INSTRUCTIONS).toContain("genuinely unreadable");
  });

  it("quotes a readable certificate photo instead of failing on too_dark or unreadable_fields", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(photoOrder({ brand: "credpronto" }));
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      if (text.includes("Read this uploaded file")) {
        return {
          pages: [
            {
              pageNumber: 1,
              text: certificate,
              unreadable: false,
              confidence: 0.92,
              logicalPage: 0,
              orderHint: "",
              orderConfidence: 0,
              legibility: 0.42,
              flags: ["too_dark", "unreadable_fields"],
            },
          ],
        };
      }
      return {
        language: "ar",
        confidence: 0.93,
        full_name: "",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);

    expect(db.replacePages).toHaveBeenCalledWith(
      dbHandle,
      "doc-1",
      [expect.objectContaining({ needsReview: false, qualityFlags: ["too_dark", "unreadable_fields"] })],
    );
    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({ status: "quoted", review_reason: null, source_language: "ar" }),
    );
    expect(translationJobs.queueEarlyTranslation).toHaveBeenCalledWith(dbHandle, orderId, null);
  });

  it("quotes a GCS order and queues translation when the photo is flagged image_quality", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(photoOrder({ sourceLanguage: "auto" }));
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      if (text.includes("Read this uploaded file")) {
        return {
          pages: [
            {
              pageNumber: 1,
              text: "جمهورية السودان",
              unreadable: true,
              confidence: 0.2,
              logicalPage: 0,
              orderHint: "",
              orderConfidence: 0,
              legibility: 0.31,
              flags: ["blurry", "too_dark", "unreadable_fields"],
            },
          ],
        };
      }
      return {
        language: "ar",
        confidence: 0.2,
        full_name: "",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId, "desk-token");

    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({
        status: "quoted",
        review_reason: null,
        source_language: "ar",
        total_cents: 0,
        translation_cents: 0,
        unit_price_cents: 0,
      }),
    );
    const patch = vi.mocked(db.updateOrder).mock.calls.at(-1)?.[2] as { review_reason?: string | null };
    expect(patch.review_reason).toBeNull();
    expect(translationJobs.queueEarlyTranslation).toHaveBeenCalledWith(dbHandle, orderId, "desk-token");
    expect(db.markDocuments).not.toHaveBeenCalled();
  });

  it("still holds a public order when the photo is genuinely unreadable", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(photoOrder({ brand: "credpronto", sourceLanguage: null }));
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      if (text.includes("Read this uploaded file")) {
        return {
          pages: [
            {
              pageNumber: 1,
              text: "",
              unreadable: true,
              confidence: 0.1,
              logicalPage: 0,
              orderHint: "",
              orderConfidence: 0,
              legibility: 0.2,
              flags: ["blurry", "too_dark"],
            },
          ],
        };
      }
      return {
        language: "ar",
        confidence: 0.9,
        full_name: "",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);

    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({ status: "needs_review", review_reason: "image_quality" }),
    );
    expect(translationJobs.queueEarlyTranslation).not.toHaveBeenCalled();
  });
});
