import { describe, expect, it } from "vitest";
import { WORD_PAGE_RULE } from "./billing";
import type { OrderRecord, PageRecord } from "./types";
import { previewPages, toCustomerOrder } from "./view";

function orderRecord(): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    status: "quoted",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: false,
    billablePages: 2,
    unitPriceCents: 995,
    totalCents: 1990,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: "order-1/original-combined.pdf",
    finalTranslationPath: null,
    certificationPath: null,
    createdAt: "2026-10-12T00:00:00.000Z",
  };
}

function page(patch: Partial<PageRecord> & { documentId: string; number: number }): PageRecord & { number: number } {
  return {
    id: `page-${patch.number}`,
    pageNumber: patch.number,
    wordCount: 10,
    billableUnits: 1,
    billingBasis: "words",
    ocrText: null,
    needsReview: false,
    widthPt: 612,
    heightPt: 792,
    ...patch,
  };
}

describe("customer order", () => {
  it("includes the customer email", () => {
    const order = toCustomerOrder({
      order: orderRecord(),
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
    });
    expect(order.email).toBe("ada@example.com");
    expect(order.orderId).toBe("order-1");
    expect(order.pageRule).toBe(WORD_PAGE_RULE);
    expect(order).not.toHaveProperty("combinedOriginalPath");
  });

  it("passes through a missing customer email as null", () => {
    const order = toCustomerOrder({
      order: orderRecord(),
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: null,
    });
    expect(order.email).toBeNull();
  });
});

describe("preview pages", () => {
  it("stamps each page with document id, upload index, and filename", () => {
    const pages = previewPages(
      [
        { id: "doc-b", filename: "transcript.pdf", position: 2 },
        { id: "doc-a", filename: "diploma.pdf", position: 1 },
      ],
      [
        page({ documentId: "doc-a", number: 1, pageNumber: 1, widthPt: null, heightPt: null }),
        page({ documentId: "doc-b", number: 2, pageNumber: 1, widthPt: 500, heightPt: 700 }),
      ],
    );

    expect(pages).toEqual([
      {
        number: 1,
        widthPt: 612,
        heightPt: 792,
        documentId: "doc-a",
        documentIndex: 0,
        documentName: "diploma.pdf",
      },
      {
        number: 2,
        widthPt: 500,
        heightPt: 700,
        documentId: "doc-b",
        documentIndex: 1,
        documentName: "transcript.pdf",
      },
    ]);
  });
});
