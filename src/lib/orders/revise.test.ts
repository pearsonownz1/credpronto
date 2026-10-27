import { beforeEach, describe, expect, it, vi } from "vitest";
import * as certification from "./certification";
import * as db from "./db";
import * as finalFile from "./final-file";
import * as pdfRender from "./pdf/render";
import { editOrderTranslation, parseTranslationEdits } from "./revise";
import * as staff from "./staff";
import * as storage from "./storage";
import type { OrderRecord, PageRecord } from "./types";

const orderId = "28492f38-3333-4333-8333-333333333333";
const dbHandle = {} as db.Db;

const table = { type: "table" as const, header: true, rows: [["Course", "Grade"], ["Law", "A"]] };

function pages(): PageRecord[] {
  return [1, 2].map((pageNumber) => ({
    id: `page-${pageNumber}`,
    documentId: "doc-1",
    pageNumber,
    wordCount: 2,
    billableUnits: 1,
    billingBasis: "words",
    ocrText: pageNumber === 1 ? "Curso de Derecho" : "Segunda pagina",
    needsReview: false,
    widthPt: 595,
    heightPt: 842,
    uploadPage: pageNumber,
    logicalPage: pageNumber,
    orderHint: null,
    qualityScore: null,
    qualityFlags: [],
    qualityMessage: null,
  }));
}

describe("parseTranslationEdits", () => {
  it("accepts a paragraph-only edit", () => {
    expect(
      parseTranslationEdits({
        pages: [{ documentId: "doc-1", pageNumber: 1, paragraphs: [" Hello "] }],
      }),
    ).toEqual([{ documentId: "doc-1", pageNumber: 1, paragraphs: [" Hello "] }]);
  });

  it("keeps sanitized blocks and kind when the table editor sends them", () => {
    expect(
      parseTranslationEdits({
        pages: [
          {
            documentId: "doc-1",
            pageNumber: 1,
            paragraphs: ["Law A"],
            kind: "certificate",
            blocks: [table, { type: "ignored" }],
          },
        ],
      }),
    ).toEqual([
      {
        documentId: "doc-1",
        pageNumber: 1,
        paragraphs: ["Law A"],
        kind: "certificate",
        blocks: [table],
      },
    ]);
  });
});

describe("editOrderTranslation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: dbHandle, userId: "staff-1", role: "admin" });
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      id: orderId,
      customerId: "customer-1",
      status: "paid",
      sourceLanguage: "es",
      targetLanguage: "en",
      billablePages: 2,
      degreeCount: null,
      combinedOriginalPath: null,
    } as OrderRecord);
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      { id: "doc-1", filename: "diploma.pdf", position: 1, appliedPosition: null } as Awaited<
        ReturnType<typeof db.listDocuments>
      >[number],
    ]);
    vi.spyOn(db, "listPages").mockResolvedValue(pages());
    vi.spyOn(db, "listTranslations").mockResolvedValue([
      {
        id: "tr-1",
        documentId: "doc-1",
        version: 1,
        model: "test",
        status: "ready",
        output: {
          pages: [
            { pageNumber: 1, kind: "certificate", paragraphs: ["Law A"], blocks: [table] },
            { pageNumber: 2, paragraphs: ["Second page"] },
          ],
        },
      },
    ]);
    vi.spyOn(db, "nextPreviewVersion").mockResolvedValue(2);
    vi.spyOn(db, "nextTranslationVersion").mockResolvedValue(2);
    vi.spyOn(db, "insertPreview").mockResolvedValue("inserted");
    vi.spyOn(db, "insertTranslation").mockResolvedValue(undefined);
    vi.spyOn(db, "listConfirmations").mockResolvedValue([]);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "markPreview").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "getDelivery").mockResolvedValue(null);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(certification, "approverDisplayName").mockResolvedValue("Ada Lovelace");
    vi.spyOn(finalFile, "storeCertifiedTranslation").mockResolvedValue(`${orderId}/certified-translation-v2.pdf`);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(pdfRender, "renderOrderPdfs").mockResolvedValue({
      cleanTranslation: new Uint8Array([1]),
      watermarkedPreview: new Uint8Array([2]),
      certification: new Uint8Array([3]),
      pageTexts: [],
    });
  });

  it("keeps stored blocks on pages the line editor did not change", async () => {
    await editOrderTranslation(orderId, {
      pages: [{ documentId: "doc-1", pageNumber: 2, paragraphs: ["Corrected second page"] }],
    });

    const output = vi.mocked(db.insertTranslation).mock.calls[0]?.[1].output as {
      pages: Array<{ pageNumber: number; blocks?: unknown; kind?: string; paragraphs: unknown }>;
    };
    expect(output.pages[0]).toMatchObject({ pageNumber: 1, kind: "certificate", blocks: [table] });
    expect(output.pages[1]?.blocks).toBeUndefined();
    expect(output.pages[1]?.paragraphs).toEqual([expect.objectContaining({ text: "Corrected second page" })]);

    const rendered = vi.mocked(pdfRender.renderOrderPdfs).mock.calls[0]?.[0];
    expect(rendered?.pages[0]).toMatchObject({ blocks: [table], kind: "certificate" });
    expect(rendered?.pages[1]?.blocks).toBeUndefined();
    expect(rendered?.pages[1]?.paragraphs).toEqual(["Corrected second page"]);
  });

  it("stores and renders blocks sent with a page edit", async () => {
    const next = { type: "table" as const, header: true, rows: [["Course", "Grade"], ["Law", "B"]] };
    await editOrderTranslation(orderId, {
      pages: [
        {
          documentId: "doc-1",
          pageNumber: 1,
          paragraphs: ["Law B"],
          kind: "certificate",
          blocks: [next],
        },
      ],
    });

    const output = vi.mocked(db.insertTranslation).mock.calls[0]?.[1].output as {
      pages: Array<{ blocks?: unknown; kind?: string }>;
    };
    expect(output.pages[0]).toMatchObject({ kind: "certificate", blocks: [next] });
    expect(output.pages[1]?.blocks).toBeUndefined();
    expect(vi.mocked(pdfRender.renderOrderPdfs).mock.calls[0]?.[0].pages[0]).toMatchObject({
      blocks: [next],
      kind: "certificate",
    });
  });
});
