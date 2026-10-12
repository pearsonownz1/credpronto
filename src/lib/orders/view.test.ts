import { describe, expect, it } from "vitest";
import { addonOptions } from "./addons";
import { WORD_PAGE_RULE } from "./billing";
import type { OrderRecord, PageRecord } from "./types";
import { previewPages, toCustomerOrder } from "./view";

function orderRecord(): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "translation",
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
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "translation",
    service: null,
    degreeCount: null,
    evaluationCents: null,
    translationCents: null,
    evaluationResult: null,
    addonCents: 0,
    expedited: false,
    shippingAddress: null,
    mailStatus: null,
    mailTracking: null,
    notarizationStatus: null,
    edgeCredentialId: null,
    edgeGradingScaleId: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
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
    uploadPage: patch.pageNumber ?? patch.number,
    logicalPage: null,
    orderHint: null,
    qualityScore: null,
    qualityFlags: [],
    qualityMessage: null,
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
    expect(order.pageLineItems).toEqual([]);
    expect(order.addons).toEqual([]);
    expect(order.addonOptions).toEqual(addonOptions(2));
    expect(order.shippingAddress).toBeNull();
    expect(order.totalCents).toBe(1990);
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

  it("exposes the evaluation choice and line items", () => {
    const order = toCustomerOrder({
      order: {
        ...orderRecord(),
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 995,
        billablePages: 1,
        totalCents: 2990,
      },
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
    });
    expect(order.orderType).toBe("evaluation");
    expect(order.service).toBe("diploma");
    expect(order.degreeCount).toBe(1);
    expect(order.lineItems.map((item) => item.kind)).toEqual(["evaluation", "translation"]);
    expect(order.evaluation).toBeNull();
    expect(order).not.toHaveProperty("edge");
    expect(order).not.toHaveProperty("edgeCredentialId");
    expect(JSON.stringify(order)).not.toContain("edge_credential");
  });

  it("returns the selected add-ons in catalog order with the stored address", () => {
    const order = toCustomerOrder({
      order: {
        ...orderRecord(),
        totalCents: 7765,
        shippingAddress: {
          name: "Ada Lovelace",
          line1: "2520 Venture Oaks Way",
          line2: null,
          city: "Sacramento",
          state: "CA",
          postalCode: "95833",
          country: "US",
        },
      },
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
      addons: [{ id: "mail" }, { id: "notarization" }],
    });
    expect(order.addons).toEqual(["notarization", "mail"]);
    expect(order.shippingAddress?.state).toBe("CA");
    expect(order.totalCents).toBe(7765);
  });

  it("marks a translation delayed after 15 minutes without a preview", () => {
    const shared = {
      documents: [],
      confirmations: [],
      previewVersion: null as number | null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
      now: Date.parse("2026-10-12T00:20:00.000Z"),
    };
    expect(
      toCustomerOrder({
        ...shared,
        order: {
          ...orderRecord(),
          status: "processing",
          updatedAt: "2026-10-12T00:00:00.000Z",
          progress: { step: "translating", pagesRead: 2, pagesTotal: 2 },
        },
      }).delayed,
    ).toBe(true);
    expect(
      toCustomerOrder({
        ...shared,
        order: {
          ...orderRecord(),
          status: "processing",
          updatedAt: "2026-10-12T00:10:00.000Z",
        },
      }).delayed,
    ).toBe(false);
    expect(
      toCustomerOrder({
        ...shared,
        previewVersion: 1,
        order: { ...orderRecord(), status: "processing", updatedAt: "2026-10-12T00:00:00.000Z" },
      }).delayed,
    ).toBe(false);
    expect(toCustomerOrder({ ...shared, order: orderRecord() }).delayed).toBe(false);
    expect(
      toCustomerOrder({
        ...shared,
        order: {
          ...orderRecord(),
          status: "needs_review",
          reviewReason: "translation_timeout",
          updatedAt: "2026-10-12T00:19:00.000Z",
          progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
        },
      }).delayed,
    ).toBe(true);
    expect(
      toCustomerOrder({
        ...shared,
        order: {
          ...orderRecord(),
          status: "needs_review",
          reviewReason: "image_quality",
          updatedAt: "2026-10-12T00:00:00.000Z",
          progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
        },
      }).delayed,
    ).toBe(false);
    expect(toCustomerOrder({ ...shared, order: orderRecord() }).progress).not.toHaveProperty("retries");
  });

  it("exposes stored read progress on the customer order", () => {
    const shared = {
      order: orderRecord(),
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
    };
    expect(toCustomerOrder(shared).progress).toEqual({ step: "done", pagesRead: 2, pagesTotal: 2 });
    expect(
      toCustomerOrder({
        ...shared,
        order: { ...orderRecord(), progress: { step: "reading", pagesRead: 6, pagesTotal: 9 } },
      }).progress,
    ).toEqual({ step: "reading", pagesRead: 6, pagesTotal: 9 });
    expect(
      toCustomerOrder({
        ...shared,
        order: { ...orderRecord(), progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 } },
      }).progress,
    ).toEqual({ step: "uploaded", pagesRead: 0, pagesTotal: 0 });
  });

  it("passes page ids and optional billing fields, and omits them when absent", () => {
    const priced = toCustomerOrder({
      order: orderRecord(),
      documents: [],
      pages: [
        page({ documentId: "doc-a", number: 1, billableUnits: 2, skip: true, skipReason: "already English" }),
        page({ documentId: "doc-a", number: 2, billableUnits: null }),
      ],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
    });
    expect(priced.pages[0]).toMatchObject({
      id: "page-1",
      billableUnits: 2,
      skip: true,
      skipReason: "already English",
    });
    expect(priced.pages[1]).not.toHaveProperty("billableUnits");
    expect(priced.pages[1]).not.toHaveProperty("skip");
    expect(priced.pages[1]?.id).toBe("page-2");
    expect(priced.pageLineItems[0]).toEqual({
      pageIndex: 0,
      billableUnits: 0,
      skip: true,
      skipReason: "already English",
    });
  });
});

describe("page line items", () => {
  it("exposes pageIndex, billable units, and skip reason", () => {
    const order = toCustomerOrder({
      order: orderRecord(),
      documents: [],
      pages: [
        page({
          documentId: "doc",
          number: 1,
          ocrText: "This is to certify that the student record is true and complete.",
          billableUnits: 0,
          wordCount: 12,
        }),
        page({
          documentId: "doc",
          number: 2,
          ocrText: "课".repeat(1500),
          billableUnits: 2,
          billingBasis: "cjk",
          wordCount: 1500,
        }),
      ],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
    });

    expect(order.pageLineItems).toEqual([
      { pageIndex: 0, billableUnits: 0, skip: true, skipReason: "english" },
      { pageIndex: 1, billableUnits: 2, skip: false, skipReason: null },
    ]);
    expect(order.pages.map((item) => item.pageIndex)).toEqual([0, 1]);
    expect(order.billablePages).toBe(2);
    expect(order.totalCents).toBe(1990);
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
