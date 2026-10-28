import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeOrder, fieldDetectionText } from "./analysis";
import * as evaluation from "./evaluation";
import * as translationJobs from "./translation-jobs";
import * as ai from "./ai";
import * as db from "./db";
import * as storage from "./storage";
import * as webhooks from "./webhook-delivery";
import type { DocumentRecord, OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const dbHandle = {} as db.Db;

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = Array.from({ length: 40 }, () => "alpha").join(" ");
  for (let index = 0; index < 2; index += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 48, y: 740, size: 11, font, maxWidth: 516 });
  }
  return doc.save();
}

describe("quote progress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("advances pagesRead once per extracted page, then the later steps", async () => {
    const bytes = await twoPagePdf();
    const document = {
      id: "doc-1",
      orderId,
      originalPath: `${orderId}/upload.pdf`,
      filename: "upload.pdf",
      mime: "application/pdf",
      position: 1,
    } as DocumentRecord;
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      id: orderId,
      status: "draft",
      languageConfirmed: false,
      service: null,
      degreeCount: null,
      targetLanguage: "en",
    } as OrderRecord);
    vi.spyOn(db, "claimDocuments").mockResolvedValue([document]);
    vi.spyOn(db, "setOrderProgress").mockResolvedValue(undefined);
    vi.spyOn(db, "replacePages").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDocument").mockResolvedValue(undefined);
    vi.spyOn(db, "replaceExtractedConfirmations").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "hasEvent").mockResolvedValue(true);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "markDocuments").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      if (text.includes("text layers")) {
        return {
          pages: [1, 2].map((pageNumber) => ({
            pageNumber,
            logicalPage: 0,
            orderHint: "",
            orderConfidence: 0,
            legibility: 1,
            flags: [],
          })),
        };
      }
      return {
        language: "es",
        confidence: 0.95,
        full_name: "Ada Lovelace",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);

    const writes = vi.mocked(db.setOrderProgress).mock.calls.map((call) => call[2]);
    expect(writes).toEqual([
      { step: "reading", pagesRead: 0, pagesTotal: 0 },
      { step: "reading", pagesRead: 1, pagesTotal: 2 },
      { step: "reading", pagesRead: 2, pagesTotal: 2 },
      { step: "language", pagesRead: 2, pagesTotal: 2 },
      { step: "counting", pagesRead: 2, pagesTotal: 2 },
      { step: "quoting", pagesRead: 2, pagesTotal: 2 },
    ]);
    expect(writes.every((progress) => progress.pagesRead <= progress.pagesTotal)).toBe(true);
    expect(db.updateOrder).toHaveBeenCalledWith(
      dbHandle,
      orderId,
      expect.objectContaining({
        progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
      }),
    );
    expect(db.markDocuments).not.toHaveBeenCalled();
  });

  it("starts language detection before the page read finishes", async () => {
    const bytes = await twoPagePdf();
    const document = {
      id: "doc-1",
      orderId,
      originalPath: `${orderId}/upload.pdf`,
      filename: "upload.pdf",
      mime: "application/pdf",
      position: 1,
    } as DocumentRecord;
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      id: orderId,
      status: "draft",
      languageConfirmed: false,
      service: null,
      degreeCount: null,
      targetLanguage: "en",
    } as OrderRecord);
    vi.spyOn(db, "claimDocuments").mockResolvedValue([document]);
    vi.spyOn(db, "setOrderProgress").mockResolvedValue(undefined);
    vi.spyOn(db, "replacePages").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDocument").mockResolvedValue(undefined);
    vi.spyOn(db, "replaceExtractedConfirmations").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "hasEvent").mockResolvedValue(true);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "markDocuments").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(translationJobs, "queueEarlyTranslation").mockResolvedValue(undefined);

    let started = 0;
    let releaseBoth: () => void = () => {};
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    let releaseOrder: () => void = () => {};
    let releaseFields: () => void = () => {};
    const orderGate = new Promise<void>((resolve) => {
      releaseOrder = resolve;
    });
    const fieldsGate = new Promise<void>((resolve) => {
      releaseFields = resolve;
    });
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      started += 1;
      if (started >= 2) releaseBoth();
      if (text.includes("text layers")) {
        await orderGate;
        return {
          pages: [1, 2].map((pageNumber) => ({
            pageNumber,
            logicalPage: 0,
            orderHint: "",
            orderConfidence: 0,
            legibility: 1,
            flags: [],
          })),
        };
      }
      await fieldsGate;
      return {
        language: "es",
        confidence: 0.95,
        full_name: "Ada Lovelace",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    const pending = analyzeOrder(dbHandle, orderId);
    await bothStarted;
    expect(started).toBeGreaterThanOrEqual(2);
    releaseOrder();
    releaseFields();
    await pending;

    const writes = vi.mocked(db.setOrderProgress).mock.calls.map((call) => call[2]);
    const reads = writes.filter((progress) => progress.step === "reading").map((progress) => progress.pagesRead);
    expect(reads).toEqual([0, 1, 2]);
    expect(writes.map((progress) => progress.pagesRead)).toEqual([0, 1, 2, 2, 2, 2]);
    expect(translationJobs.queueEarlyTranslation).toHaveBeenCalledWith(dbHandle, orderId, null);
    expect(db.markDocuments).not.toHaveBeenCalled();
  });

  it("does not queue translation for an evaluation order", async () => {
    const bytes = await twoPagePdf();
    const document = {
      id: "doc-1",
      orderId,
      originalPath: `${orderId}/upload.pdf`,
      filename: "upload.pdf",
      mime: "application/pdf",
      position: 1,
    } as DocumentRecord;
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      id: orderId,
      status: "draft",
      languageConfirmed: false,
      service: "diploma",
      degreeCount: 1,
      orderType: "evaluation",
      serviceType: "evaluation",
      targetLanguage: "en",
    } as OrderRecord);
    vi.spyOn(db, "claimDocuments").mockResolvedValue([document]);
    vi.spyOn(db, "setOrderProgress").mockResolvedValue(undefined);
    vi.spyOn(db, "replacePages").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDocument").mockResolvedValue(undefined);
    vi.spyOn(db, "replaceExtractedConfirmations").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "hasEvent").mockResolvedValue(true);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "markDocuments").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(evaluation, "completeEvaluation").mockResolvedValue({
      status: "preview_ready",
      totalCents: 1995,
      billablePages: 1,
    });
    const queue = vi.spyOn(translationJobs, "queueEarlyTranslation").mockResolvedValue(undefined);
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      if (text.includes("text layers")) {
        return {
          pages: [1, 2].map((pageNumber) => ({
            pageNumber,
            logicalPage: 0,
            orderHint: "",
            orderConfidence: 0,
            legibility: 1,
            flags: [],
          })),
        };
      }
      return {
        language: "es",
        confidence: 0.95,
        full_name: "Ada Lovelace",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);
    expect(queue).not.toHaveBeenCalled();
    expect(evaluation.completeEvaluation).toHaveBeenCalled();
  });

  it("queues translation after a bundle quote", async () => {
    const bytes = await twoPagePdf();
    const document = {
      id: "doc-1",
      orderId,
      originalPath: `${orderId}/upload.pdf`,
      filename: "upload.pdf",
      mime: "application/pdf",
      position: 1,
    } as DocumentRecord;
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      id: orderId,
      status: "draft",
      languageConfirmed: false,
      service: "diploma",
      degreeCount: 1,
      includeTranslation: true,
      orderType: "evaluation",
      serviceType: "evaluation",
      targetLanguage: "en",
    } as OrderRecord);
    vi.spyOn(db, "claimDocuments").mockResolvedValue([document]);
    vi.spyOn(db, "setOrderProgress").mockResolvedValue(undefined);
    vi.spyOn(db, "replacePages").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDocument").mockResolvedValue(undefined);
    vi.spyOn(db, "replaceExtractedConfirmations").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "hasEvent").mockResolvedValue(true);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "markDocuments").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(evaluation, "completeEvaluation").mockResolvedValue({
      status: "preview_ready",
      totalCents: 2990,
      billablePages: 1,
    });
    const queue = vi.spyOn(translationJobs, "queueEarlyTranslation").mockResolvedValue(undefined);
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      if (text.includes("text layers")) {
        return {
          pages: [1, 2].map((pageNumber) => ({
            pageNumber,
            logicalPage: 0,
            orderHint: "",
            orderConfidence: 0,
            legibility: 1,
            flags: [],
          })),
        };
      }
      return {
        language: "es",
        confidence: 0.95,
        full_name: "Ada Lovelace",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);
    expect(evaluation.completeEvaluation).toHaveBeenCalled();
    expect(queue).toHaveBeenCalledWith(dbHandle, orderId, null);
  });
});

describe("thin text layer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for OCR text instead of sending the file to detection in parallel", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const document = {
      id: "doc-1",
      orderId,
      originalPath: `${orderId}/blank.pdf`,
      filename: "blank.pdf",
      mime: "application/pdf",
      position: 1,
    } as DocumentRecord;
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      id: orderId,
      status: "draft",
      languageConfirmed: false,
      service: null,
      degreeCount: null,
      targetLanguage: "en",
    } as OrderRecord);
    vi.spyOn(db, "claimDocuments").mockResolvedValue([document]);
    vi.spyOn(db, "setOrderProgress").mockResolvedValue(undefined);
    vi.spyOn(db, "replacePages").mockResolvedValue(undefined);
    vi.spyOn(db, "updateDocument").mockResolvedValue(undefined);
    vi.spyOn(db, "replaceExtractedConfirmations").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "hasEvent").mockResolvedValue(true);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "markDocuments").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);

    let inFlight = 0;
    let maxInFlight = 0;
    const prompts: string[] = [];
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = JSON.stringify(messages);
      prompts.push(text);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      if (text.includes("text layers") || text.includes("Read this uploaded file")) {
        return {
          pages: [
            {
              pageNumber: 1,
              text: Array.from({ length: 30 }, () => "acta").join(" "),
              unreadable: false,
              confidence: 0.9,
              logicalPage: 0,
              orderHint: "",
              orderConfidence: 0,
              legibility: 1,
              flags: [],
            },
          ],
        };
      }
      return {
        language: "es",
        confidence: 0.95,
        full_name: "Ada Lovelace",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);

    expect(maxInFlight).toBe(1);
    expect(prompts.some((prompt) => prompt.includes("Read the attached file"))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes("Read this uploaded file") || prompt.includes("text layers"))).toBe(
      true,
    );
    expect(prompts.some((prompt) => prompt.includes("Document text:"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("Never write [illegible]"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("[unclear]"))).toBe(false);
    expect(db.markDocuments).not.toHaveBeenCalled();
  });
});

describe("field detection text", () => {
  it("uses a dense text layer and skips a thin one", () => {
    const dense = Array.from({ length: 20 }, () => "alpha").join(" ");
    expect(fieldDetectionText([dense])).toBe(dense);
    expect(fieldDetectionText(["too short"])).toBeNull();
    expect(fieldDetectionText([])).toBeNull();
  });
});
