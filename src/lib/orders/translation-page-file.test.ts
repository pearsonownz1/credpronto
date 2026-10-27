import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as orderDb from "./db";
import * as storage from "./storage";
import { loadPageWork } from "./translation-jobs";
import type { Db } from "./db";
import type { DocumentRecord, OrderRecord, PageRecord } from "./types";

function query(row: Record<string, unknown> | null) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return builder;
}

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage();
  first.drawText("PAGE-ONE-ONLY", { x: 72, y: 700, size: 18, font });
  const second = doc.addPage();
  second.drawText("PAGE-TWO-ONLY", { x: 72, y: 700, size: 18, font });
  return doc.save();
}

describe("loadPageWork pdf attachment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches only the requested page of an uploaded PDF", async () => {
    const pdf = await twoPagePdf();
    const document: DocumentRecord = {
      id: "doc-1",
      orderId: "order-1",
      originalPath: "order-1/diploma.pdf",
      filename: "diploma.pdf",
      mime: "application/pdf",
      size: pdf.byteLength,
      pageCount: 2,
      status: "ready",
      detectedLanguage: "es",
      confidence: 1,
      position: 0,
      appliedPosition: null,
    };
    const page: PageRecord = {
      id: "page-2",
      documentId: "doc-1",
      pageNumber: 2,
      wordCount: 12,
      billableUnits: 1,
      billingBasis: "words",
      ocrText: "registro",
      needsReview: false,
      widthPt: 612,
      heightPt: 792,
      uploadPage: 2,
      logicalPage: 2,
      orderHint: null,
      qualityScore: null,
      qualityFlags: [],
      qualityMessage: null,
    };
    vi.spyOn(orderDb, "getOrderById").mockResolvedValue({
      id: "order-1",
      sourceLanguage: "es",
      targetLanguage: "en",
    } as OrderRecord);
    vi.spyOn(orderDb, "listDocuments").mockResolvedValue([document]);
    vi.spyOn(orderDb, "listPages").mockResolvedValue([page]);
    vi.spyOn(orderDb, "listConfirmations").mockResolvedValue([]);
    vi.spyOn(orderDb, "listCorrections").mockResolvedValue([]);
    const download = vi.spyOn(storage, "downloadObject").mockResolvedValue(pdf);
    const db = {
      from(table: string) {
        if (table === "translation_page_jobs") {
          return query({
            id: "job-1",
            order_id: "order-1",
            version: 1,
            document_id: "doc-1",
            page_id: "page-2",
            page_number: 2,
            combined_page_number: 2,
            status: "running",
            attempts: 0,
            output: null,
            error: null,
            updated_at: "2026-01-01T00:00:00.000Z",
          });
        }
        if (table === "translation_runs") {
          return query({
            order_id: "order-1",
            version: 1,
            status: "running",
            page_count: 2,
            round: 0,
            token: null,
            qa_issues: [],
            updated_at: "2026-01-01T00:00:00.000Z",
          });
        }
        throw new Error(table);
      },
    } as unknown as Db;

    const work = await loadPageWork(db, "job-1");
    expect(download).toHaveBeenCalledWith(db, "originals", "order-1/diploma.pdf");
    expect(work?.pageFile?.mime).toBe("application/pdf");
    const bytes = work?.pageFile?.bytes;
    expect(bytes).toBeTruthy();
    const slice = await PDFDocument.load(bytes ?? new Uint8Array());
    expect(slice.getPageCount()).toBe(1);
    const proxy = await getDocumentProxy(Uint8Array.from(bytes ?? []));
    const extracted = await extractText(proxy, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toContain("PAGE-TWO-ONLY");
    expect(text).not.toContain("PAGE-ONE-ONLY");
  });
});
