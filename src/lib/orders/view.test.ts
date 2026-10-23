import { describe, expect, it } from "vitest";
import { addonOptions } from "./addons";
import { WORD_PAGE_RULE } from "./billing";
import { EVALUATION_REVIEW_REASON } from "./evaluation-price";
import { QA_REVIEW_REASON } from "./qa";
import { HIGH_QA_SCORE } from "./release-decision";
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
    paidAt: null,
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
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
    expect(order.addonOptions).toEqual(addonOptions(2, orderRecord()));
    expect(order.addonOptions.map((item) => item.id)).toEqual(["notarization", "mail"]);
    expect(order.expeditedUnit).toBe("order");
    expect(order.shippingAddress).toBeNull();
    expect(order.totalCents).toBe(1990);
    expect(order).not.toHaveProperty("combinedOriginalPath");
    expect(order.uploadedAt).toBe("2026-10-12T00:00:00.000Z");
    expect(order.translationReadyAt).toBeNull();
    expect(order.deliveredAt).toBeNull();
  });

  it("times a translation from the upload and a delivery from its stored instants", () => {
    const order = toCustomerOrder({
      order: orderRecord(),
      documents: [
        {
          id: "doc-1",
          orderId: "order-1",
          originalPath: "order-1/a.pdf",
          filename: "a.pdf",
          mime: "application/pdf",
          size: 10,
          pageCount: 1,
          status: "uploaded",
          detectedLanguage: "es",
          confidence: 0.9,
          position: 1,
          appliedPosition: 1,
          createdAt: "2026-10-12T00:00:03.000Z",
        },
      ],
      confirmations: [],
      previewVersion: 1,
      paymentStatus: "paid",
      deliveryStatus: "delivered",
      deliveredAt: "2026-10-12T00:14:00.000Z",
      translationReadyAt: "2026-10-12T00:00:07.400Z",
      email: "ada@example.com",
    });
    expect(order.uploadedAt).toBe("2026-10-12T00:00:03.000Z");
    expect(order.translationReadyAt).toBe("2026-10-12T00:00:07.400Z");
    expect(order.deliveredAt).toBe("2026-10-12T00:14:00.000Z");
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
        includeTranslation: true,
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
    expect(order.addonOptions.map((item) => item.id)).toEqual(["notarization", "mail"]);
    expect(order.expeditedUnit).toBe("order");
    expect(order.evaluationCents).toBe(1995);
    expect(order.degreeCount).toBe(1);
    expect(order.billablePages).toBe(1);
    expect(order.unitPriceCents).toBe(1995);
    expect(order.translationCents).toBe(995);
    expect(order.totalCents).toBe(2990);
    expect(order.lineItems).toEqual([
      {
        kind: "evaluation",
        description: "Diploma evaluation",
        quantity: 1,
        unitAmountCents: 1995,
        amountCents: 1995,
      },
      {
        kind: "translation",
        description: "Certified translation",
        quantity: 1,
        unitAmountCents: 995,
        amountCents: 995,
      },
    ]);
    expect(order.includeTranslation).toBe(true);
    expect(order.translationOfferCents).toBeNull();
    expect(order.unitPriceCents).not.toBe(995);
    expect(order.evaluation).toBeNull();
    expect(order.evaluationStatus).toBeNull();
    expect(order.evaluationStatusAt).toEqual({});
    expect(order.progress.step).not.toBe("delivered");
    expect(order).not.toHaveProperty("edge");
    expect(order).not.toHaveProperty("edgeCredentialId");
    expect(order).not.toHaveProperty("edgeMatchMethod");
    expect(JSON.stringify(order)).not.toContain("edge_credential");
    expect(JSON.stringify(order)).not.toContain("edge_match");
  });

  it("holds a bundle translation after payment until the whole order is delivered", () => {
    const translation = "order-1/certified-translation-v1.pdf";
    const shared = {
      order: {
        ...orderRecord(),
        status: "paid" as const,
        orderType: "evaluation" as const,
        service: "diploma" as const,
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 995,
        includeTranslation: true,
        billablePages: 1,
        totalCents: 2990,
        finalTranslationPath: translation,
        certificationPath: translation,
        reviewReason: EVALUATION_REVIEW_REASON,
      },
      documents: [
        {
          id: "doc-1",
          orderId: "order-1",
          originalPath: "order-1/diploma.pdf",
          filename: "diploma.pdf",
          mime: "application/pdf",
          size: 10,
          pageCount: 1,
          status: "ready",
          detectedLanguage: "es",
          confidence: 0.96,
          position: 0,
          appliedPosition: 0,
        },
      ],
      pages: [page({ documentId: "doc-1", number: 1 })],
      confirmations: [],
      previewVersion: 1,
      paymentStatus: "paid",
      deliveryStatus: "pending",
      deliveryFinalPath: null,
      qa: { status: "pass" as const, score: HIGH_QA_SCORE },
      openCorrections: false,
      email: "ada@example.com",
    };
    expect(toCustomerOrder(shared).translationReady).toBe(false);
    expect(
      toCustomerOrder({
        ...shared,
        order: { ...shared.order, reviewReason: QA_REVIEW_REASON },
        qa: { status: "fail", score: 40 },
      }).translationReady,
    ).toBe(false);
    expect(
      toCustomerOrder({
        ...shared,
        order: { ...shared.order, status: "delivered", reviewReason: QA_REVIEW_REASON },
        qa: { status: "fail", score: 40 },
        deliveryStatus: "delivered",
        deliveryFinalPath: "order-1/evaluation.pdf",
      }).translationReady,
    ).toBe(true);
  });

  it("copies evaluation status and step timestamps onto the customer order", () => {
    const order = toCustomerOrder({
      order: {
        ...orderRecord(),
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 0,
        evaluationStatus: "performing_layout",
        evaluationStatusAt: {
          under_review: "2026-10-21T17:02:00.000Z",
          performing_evaluation: "2026-10-21T17:11:00.000Z",
          performing_layout: "soon",
        },
      },
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: "paid",
      deliveryStatus: "pending",
      email: "ada@example.com",
    });
    expect(order.evaluationStatus).toBe("performing_layout");
    expect(order.evaluationStatusAt).toEqual({
      under_review: "2026-10-21T17:02:00.000Z",
      performing_evaluation: "2026-10-21T17:11:00.000Z",
    });
  });

  it("returns the evaluation and step delivered after the report is delivered", () => {
    const stored = {
      kind: "diploma" as const,
      pageCount: 2,
      credentials: [
        {
          applicant: "Ada Lovelace",
          institution: "Université de Paris",
          country: "France",
          credential: "Licence",
          field: "Mathematics",
          dates: "2016–2019",
          usEquivalency: "Bachelor's degree",
          documentsReviewed: ["licence.pdf"],
        },
      ],
    };
    const delivered = toCustomerOrder({
      order: {
        ...orderRecord(),
        status: "delivered",
        orderType: "evaluation",
        serviceType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 0,
        evaluationResult: stored,
        progress: { step: "uploaded", pagesRead: 0, pagesTotal: 1 },
      },
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: "paid",
      deliveryStatus: "delivered",
      email: "ada@example.com",
    });
    expect(delivered.evaluation).toEqual({
      kind: "diploma",
      credentials: stored.credentials,
    });
    expect(delivered.evaluation).not.toHaveProperty("pageCount");
    expect(delivered.progress).toEqual({ step: "delivered", pagesRead: 0, pagesTotal: 1 });

    const withoutResult = toCustomerOrder({
      order: {
        ...orderRecord(),
        status: "delivered",
        orderType: "evaluation",
        serviceType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationResult: null,
        progress: { step: "uploaded", pagesRead: 0, pagesTotal: 0 },
      },
      documents: [
        {
          id: "doc-1",
          orderId: "order-1",
          originalPath: "order-1/a.pdf",
          filename: "licence.pdf",
          mime: "application/pdf",
          size: 10,
          pageCount: 1,
          status: "uploaded",
          detectedLanguage: null,
          confidence: null,
          position: 1,
          appliedPosition: null,
        },
      ],
      confirmations: [],
      previewVersion: null,
      paymentStatus: "paid",
      deliveryStatus: "delivered",
      email: "ada@example.com",
    });
    expect(withoutResult.evaluation).toEqual({
      kind: "diploma",
      credentials: [
        {
          applicant: "",
          institution: "",
          country: "",
          credential: "",
          field: "",
          dates: "",
          usEquivalency: "",
          documentsReviewed: ["licence.pdf"],
        },
      ],
    });
    expect(withoutResult.progress.step).toBe("delivered");

    const translation = toCustomerOrder({
      order: { ...orderRecord(), status: "delivered" },
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: "paid",
      deliveryStatus: "delivered",
      email: "ada@example.com",
    });
    expect(translation.evaluation).toBeNull();
    expect(translation.progress.step).toBe("done");
  });

  it("offers translation on a Spanish diploma without adding it to the total", () => {
    const order = toCustomerOrder({
      order: {
        ...orderRecord(),
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        evaluationCents: 1995,
        translationCents: 0,
        includeTranslation: false,
        billablePages: 1,
        totalCents: 1995,
      },
      documents: [],
      confirmations: [],
      previewVersion: null,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
    });
    expect(order.includeTranslation).toBe(false);
    expect(order.billablePages).toBe(1);
    expect(order.translationOfferCents).toBe(995);
    expect(order.unitPriceCents).toBe(1995);
    expect(order.totalCents).toBe(1995);
    expect(order.lineItems.map((item) => item.kind)).toEqual(["evaluation"]);
    expect(order.lineItems.some((item) => item.unitAmountCents === 995)).toBe(false);
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

  it("marks a translation delayed after 4 minutes without a preview", () => {
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
          updatedAt: "2026-10-12T00:17:00.000Z",
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
        order: {
          ...orderRecord(),
          progress: {
            step: "translating",
            pagesRead: 12,
            pagesTotal: 12,
            pagesDone: 4,
            pagesTranslateTotal: 9,
            retries: 1,
          },
        },
      }).progress,
    ).toEqual({
      step: "translating",
      pagesRead: 12,
      pagesTotal: 12,
      pagesDone: 4,
      pagesTranslateTotal: 9,
    });
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
