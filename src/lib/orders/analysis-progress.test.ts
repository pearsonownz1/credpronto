import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeOrder } from "./analysis";
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
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
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
});
