import { describe, expect, it } from "vitest";
import { EXPEDITED_UNIT, addonOptions } from "@/lib/orders/addons";
import { CJK_PAGE_RULE, WORD_PAGE_RULE } from "@/lib/orders/billing";
import { IMAGE_QUALITY_REASON } from "@/lib/orders/image-quality";
import type { CustomerOrder, PreviewResponse } from "@/lib/orders/view";
import {
  LANGUAGE_PENDING,
  QUOTE_BILLING_NOTE,
  UPLOAD_ORDER_NOTE,
  TARGET_LANGUAGE_REVIEW_MESSAGE,
  billablePriceLabel,
  canOpenConfirm,
  canSetSourceLanguage,
  checkoutFailureMessage,
  displayedPageRule,
  ORDER_STATUS_POLL_MS,
  CONFIRMING_PAYMENT_COPY,
  CONFIRMING_PAYMENT_DETAIL,
  FINALIZING_POLL_MS,
  QUICK_CHECK_COPY,
  QUICK_CHECK_DETAIL,
  downloadEmailedLine,
  downloadReadyCopy,
  documentIdForPage,
  downloadPhase,
  joinParents,
  languageLine,
  orderHubStep,
  readyPreviewPath,
  orderStatusPollDelay,
  paidReviewEmailLine,
  fileCountLabel,
  quoteCounts,
  quoteFileGroups,
  quotePageRows,
  quoteSummaryLabel,
  orderWithTranslationChoice,
  servicePriceLines,
  settleTargetLanguageUpdate,
  showTargetLanguagePicker,
  skippedPageIndexes,
  splitParents,
  previewShellOrder,
  toPreviewOrder,
  totalLabel,
} from "./present";

function order(patch: Partial<CustomerOrder> = {}): CustomerOrder {
  const orderType = patch.orderType ?? "translation";
  const service = patch.service === undefined ? null : patch.service;
  const billablePages = patch.billablePages === undefined ? 3 : patch.billablePages;
  return {
    orderId: "order-1",
    email: "ada@example.com",
    status: "quoted",
    sourceLanguage: "es",
    sourceLanguageConfidence: 0.9,
    targetLanguage: "en",
    languageConfirmed: false,
    documents: [
      {
        id: "doc-a",
        filename: "a.pdf",
        pageCount: 2,
        detectedLanguage: "es",
        confidence: 0.9,
        uploadPosition: 1,
        appliedPosition: 1,
      },
      {
        id: "doc-b",
        filename: "b.pdf",
        pageCount: 1,
        detectedLanguage: "es",
        confidence: 0.9,
        uploadPosition: 2,
        appliedPosition: 2,
      },
    ],
    pageOrder: null,
    pages: [],
    pageLineItems: [],
    billablePages: 3,
    unitPriceCents: 995,
    totalCents: 2985,
    currency: "usd",
    pageRule: WORD_PAGE_RULE,
    etaAt: null,
    reviewReason: null,
    confirmations: [],
    previewVersion: null,
    payment: null,
    delivery: null,
    orderType: "translation",
    service: null,
    degreeCount: null,
    evaluationCents: null,
    translationCents: null,
    includeTranslation: false,
    translationOfferCents: null,
    lineItems: [],
    evaluation: null,
    progress: { step: "done", pagesRead: 3, pagesTotal: 3 },
    delayed: false,
    addons: [],
    addonOptions: addonOptions(billablePages, {
      orderType,
      service,
      serviceType: orderType === "evaluation" ? "evaluation" : "translation",
    }),
    expeditedUnit: EXPEDITED_UNIT,
    shippingAddress: null,
    ...patch,
    paidAt: patch.paidAt ?? null,
    fulfillment: patch.fulfillment ?? null,
    evaluationStatus: patch.evaluationStatus ?? null,
    evaluationStatusAt: patch.evaluationStatusAt ?? {
      under_review: null,
      performing_evaluation: null,
      performing_layout: null,
      evaluation_complete: null,
    },
    documentTitle: patch.documentTitle ?? "Document",
  };
}

describe("quote language", () => {
  it("shows the pending line when detection left the language empty", () => {
    const needsReview = order({
      status: "needs_review",
      sourceLanguage: null,
      totalCents: 1990,
      reviewReason: "Automatic language detection is unavailable.",
    });
    expect(languageLine(needsReview)).toBe(LANGUAGE_PENDING);
    expect(canSetSourceLanguage(needsReview)).toBe(false);
    expect(totalLabel(needsReview.totalCents)).toBe("$19.90");
    expect(totalLabel(null)).toBe("Pending");
  });

  it("offers a picker only while confirm can set the language", () => {
    expect(canSetSourceLanguage(order())).toBe(true);
    expect(languageLine(order())).toBe("Spanish → English");
  });

  it("asks for a new target when the detected source matches the target", () => {
    const english = order({
      status: "needs_review",
      sourceLanguage: "en",
      targetLanguage: "en",
      reviewReason: "The document appears to already be in English.",
      billablePages: 3,
      totalCents: 2985,
    });
    expect(showTargetLanguagePicker(english)).toBe(true);
    expect(languageLine({ sourceLanguage: "en", targetLanguage: "es" })).toBe("English → Spanish");
    expect(showTargetLanguagePicker(order())).toBe(false);
    expect(canOpenConfirm(english)).toBe(false);
    expect(canOpenConfirm(order({ status: "needs_review", reviewReason: IMAGE_QUALITY_REASON }))).toBe(
      false,
    );
  });

  it("continues only when a quoted order has line items and a total", () => {
    expect(canOpenConfirm(order())).toBe(true);
    expect(
      canOpenConfirm(
        order({
          lineItems: [
            {
              kind: "translation",
              description: "Certified translation",
              quantity: 2,
              unitAmountCents: 995,
              amountCents: 1990,
            },
          ],
          billablePages: 0,
          totalCents: 1990,
        }),
      ),
    ).toBe(true);
    expect(canOpenConfirm(order({ lineItems: [], billablePages: 0, totalCents: 1990 }))).toBe(false);
    expect(canOpenConfirm(order({ totalCents: null }))).toBe(false);
    expect(
      canOpenConfirm(
        order({
          status: "needs_review",
          sourceLanguage: "en",
          targetLanguage: "en",
          lineItems: [],
          billablePages: 0,
          totalCents: null,
          reviewReason: "The document appears to already be in English.",
        }),
      ),
    ).toBe(false);
    expect(
      canOpenConfirm(
        order({
          status: "needs_review",
          sourceLanguage: "en",
          targetLanguage: "en",
          lineItems: [],
          totalCents: 2985,
        }),
      ),
    ).toBe(false);
  });

  it("refetches after a target-language update and explains a missing route", () => {
    expect(settleTargetLanguageUpdate(null)).toEqual({ refetch: true, message: null });
    expect(settleTargetLanguageUpdate({ status: 404, message: "Not found" })).toEqual({
      refetch: false,
      message: TARGET_LANGUAGE_REVIEW_MESSAGE,
    });
    expect(settleTargetLanguageUpdate({ status: 405, message: "Method Not Allowed" })).toEqual({
      refetch: false,
      message: TARGET_LANGUAGE_REVIEW_MESSAGE,
    });
    expect(TARGET_LANGUAGE_REVIEW_MESSAGE).toBe("We'll review this order and email you a quote.");
    expect(settleTargetLanguageUpdate({ status: 400, message: "Pick another language" })).toEqual({
      refetch: false,
      message: "Pick another language",
    });
    expect(settleTargetLanguageUpdate({ status: 500, message: "" }).message).toBe(
      "We couldn't update the language.",
    );
  });

  it("keeps the upload page-order sentence", () => {
    expect(UPLOAD_ORDER_NOTE).toBe("We kept the pages in the order you uploaded them.");
  });

  it("shows the billable page count from the order, not the file count", () => {
    const dense = order({
      billablePages: 6,
      totalCents: 5970,
      documents: [
        {
          id: "cv",
          filename: "GuyPearsonCV_under2MB.pdf",
          pageCount: 3,
          detectedLanguage: "en",
          confidence: 0.99,
          uploadPosition: 1,
          appliedPosition: 1,
        },
      ],
    });
    expect(servicePriceLines(dense)).toEqual([
      { label: "6 pages × $9.95", amountCents: 5970 },
    ]);
    expect(servicePriceLines(order({ billablePages: 3, totalCents: 2985 }))).toEqual([
      { label: "3 pages × $9.95", amountCents: 2985 },
    ]);
    expect(servicePriceLines(order({ billablePages: 1, totalCents: 995 }))).toEqual([
      { label: "1 page × $9.95", amountCents: 995 },
    ]);
  });
});

describe("page rule", () => {
  it("replaces the 400-unit fine print on the quote", () => {
    expect(displayedPageRule(order())).toBe(QUOTE_BILLING_NOTE);
    const cjk = order({
      sourceLanguage: "zh",
      pageRule: CJK_PAGE_RULE,
    });
    expect(displayedPageRule(cjk)).toBe(QUOTE_BILLING_NOTE);
    expect(displayedPageRule(cjk)).not.toContain("400 units");
    expect(cjk.pageRule).not.toContain("400 units");
    expect(cjk.pageRule).toContain("1000");
  });
});

describe("quote counts", () => {
  it("counts files, physical pages, and billable units", () => {
    expect(quoteSummaryLabel(quoteCounts(order()))).toBe("2 files, 3 pages, 3 billable");
    const dense = order({
      documents: [
        {
          id: "cv",
          filename: "cv.pdf",
          pageCount: 2,
          detectedLanguage: "es",
          confidence: 0.9,
          uploadPosition: 1,
          appliedPosition: 1,
        },
      ],
      pages: [
        {
          id: "p1",
          documentId: "cv",
          pageNumber: 1,
          uploadPage: 1,
          logicalPage: null,
          orderHint: null,
          qualityScore: null,
          qualityFlags: [],
          qualityMessage: null,
          billableUnits: 2,
        },
        {
          id: "p2",
          documentId: "cv",
          pageNumber: 2,
          uploadPage: 2,
          logicalPage: null,
          orderHint: null,
          qualityScore: null,
          qualityFlags: [],
          qualityMessage: null,
          skip: true,
          skipReason: "already English",
        },
      ],
      billablePages: 2,
    });
    expect(quoteCounts(dense)).toEqual({ files: 1, pages: 2, billable: 2 });
    expect(quoteSummaryLabel(quoteCounts(dense))).toBe("1 file, 2 pages, 2 billable");
    const rows = quotePageRows(dense);
    expect(rows.map((row) => row.pageId)).toEqual(["p1", "p2"]);
    expect(rows.map((row) => row.pageIndex)).toEqual([0, 1]);
    expect(rows[0]?.billableUnits).toBe(2);
    expect(rows[1]?.skipReason).toBe("already English");
    expect(skippedPageIndexes(dense)).toEqual([1]);
    expect(billablePriceLabel(2, 995)).toBe("2 pages × $9.95");
    expect(billablePriceLabel(1, 995)).toBe("1 page × $9.95");
  });

  it("leaves page rows off when the new fields are missing", () => {
    expect(quotePageRows(order())).toEqual([]);
  });

  it("addresses a reordered page by its index in the pages list", () => {
    const reordered = order({
      documents: [
        {
          id: "cv",
          filename: "cv.pdf",
          pageCount: 2,
          detectedLanguage: "es",
          confidence: 0.9,
          uploadPosition: 1,
          appliedPosition: 1,
        },
      ],
      pages: [
        {
          id: "p1",
          documentId: "cv",
          pageNumber: 1,
          uploadPage: 1,
          logicalPage: null,
          orderHint: null,
          qualityScore: null,
          qualityFlags: [],
          qualityMessage: null,
        },
        {
          id: "p2",
          documentId: "cv",
          pageNumber: 2,
          uploadPage: 2,
          logicalPage: null,
          orderHint: null,
          qualityScore: null,
          qualityFlags: [],
          qualityMessage: null,
          skip: true,
          skipReason: "already English",
        },
      ],
      pageOrder: {
        basis: "logical",
        pages: [
          {
            documentId: "cv",
            filename: "cv.pdf",
            uploadPosition: 1,
            appliedPosition: 1,
            uploadPage: 2,
            appliedPage: 2,
            logicalPage: 1,
            hint: null,
            confidence: null,
          },
          {
            documentId: "cv",
            filename: "cv.pdf",
            uploadPosition: 1,
            appliedPosition: 1,
            uploadPage: 1,
            appliedPage: 1,
            logicalPage: 2,
            hint: null,
            confidence: null,
          },
        ],
      },
    });
    expect(quotePageRows(reordered).map((row) => row.pageIndex)).toEqual([1, 0]);
    expect(skippedPageIndexes(reordered)).toEqual([1]);
  });

  it("groups pages under each file", () => {
    const grouped = order({
      documents: [
        {
          id: "cv",
          filename: "cv.pdf",
          pageCount: 2,
          detectedLanguage: "es",
          confidence: 0.9,
          uploadPosition: 1,
          appliedPosition: 1,
        },
        {
          id: "photo",
          filename: "back.jpg",
          pageCount: 1,
          detectedLanguage: "es",
          confidence: 0.9,
          uploadPosition: 2,
          appliedPosition: 2,
        },
      ],
      pages: [
        {
          id: "p1",
          documentId: "cv",
          pageNumber: 1,
          uploadPage: 1,
          logicalPage: null,
          orderHint: "第 1 页",
          qualityScore: null,
          qualityFlags: [],
          qualityMessage: null,
          billableUnits: 2,
        },
        {
          id: "p2",
          documentId: "cv",
          pageNumber: 2,
          uploadPage: 2,
          logicalPage: 4,
          orderHint: null,
          qualityScore: null,
          qualityFlags: [],
          qualityMessage: null,
          skip: true,
          skipReason: "not a document",
        },
      ],
    });
    const groups = quoteFileGroups(grouped);
    expect(groups.map((group) => group.filename)).toEqual(["cv.pdf", "back.jpg"]);
    expect(groups[0]?.pages).toBe(2);
    expect(groups[0]?.billable).toBe(2);
    expect(fileCountLabel(groups[0]?.billable ?? 0)).toBe("2 billable pages");
    expect(groups[0]?.rows.map((row) => row.documentId)).toEqual(["cv", "cv"]);
    expect(groups[1]?.rows).toEqual([]);
    expect(fileCountLabel(1)).toBe("1 billable page");
  });

  it("uses the order's billed count when page units are missing", () => {
    const quoted = order({
      billablePages: 6,
      documents: [
        {
          id: "cv",
          filename: "cv.pdf",
          pageCount: 3,
          detectedLanguage: "es",
          confidence: 0.9,
          uploadPosition: 1,
          appliedPosition: 1,
        },
      ],
      pages: [1, 2, 3].map((pageNumber) => ({
        id: `p${pageNumber}`,
        documentId: "cv",
        pageNumber,
        uploadPage: pageNumber,
        logicalPage: pageNumber,
        orderHint: "第 1 页",
        qualityScore: null,
        qualityFlags: [],
        qualityMessage: null,
      })),
    });
    const [file] = quoteFileGroups(quoted);
    expect(file?.billable).toBe(6);
    expect(fileCountLabel(file?.billable ?? 0)).toBe("6 billable pages");
    expect(quotePageRows(quoted).every((row) => row.filename !== "")).toBe(true);
  });
});

describe("download phase", () => {
  it("finalizes a release, then waits only when the order is flagged", () => {
    expect(downloadPhase(order({ status: "preview_ready" }))).toBe("finalizing");
    expect(
      downloadPhase(
        order({
          status: "paid",
          payment: { status: "paid" },
          delivery: { status: "pending" },
          fulfillment: "awaiting_review",
        }),
      ),
    ).toBe("certifying");
    expect(
      downloadPhase(
        order({
          status: "needs_review",
          paidAt: "2026-04-01T00:00:00.000Z",
          payment: { status: "paid" },
          delivery: { status: "pending" },
          fulfillment: "awaiting_review",
        }),
      ),
    ).toBe("certifying");
    expect(
      downloadPhase(
        order({
          status: "paid",
          payment: { status: "paid_test" },
          delivery: { status: "approved" },
        }),
      ),
    ).toBe("ready");
    expect(
      downloadPhase(
        order({
          status: "paid",
          payment: { status: "paid" },
          delivery: { status: "pending" },
          fulfillment: "released",
          paidAt: "2026-04-01T00:00:00.000Z",
        }),
      ),
    ).toBe("ready");
    expect(
      downloadPhase(
        order({
          status: "approved",
          payment: { status: "paid" },
          delivery: { status: "approved" },
          fulfillment: "awaiting_review",
          paidAt: "2026-04-01T00:00:00.000Z",
        }),
      ),
    ).toBe("certifying");
    expect(orderStatusPollDelay("certifying")).toBe(ORDER_STATUS_POLL_MS);
    expect(orderStatusPollDelay("finalizing")).toBe(FINALIZING_POLL_MS);
    expect(orderStatusPollDelay("ready")).toBeNull();
    expect(CONFIRMING_PAYMENT_COPY).toBe("Confirming payment");
    expect(CONFIRMING_PAYMENT_DETAIL).not.toMatch(/second|minute|countdown|usually/i);
    expect(QUICK_CHECK_COPY).toBe("Quick final check");
    expect(QUICK_CHECK_DETAIL).not.toMatch(/second|minute|countdown|usually/i);
    expect(paidReviewEmailLine("ada@example.com")).toBe(
      "We'll email ada@example.com when it is released.",
    );
    expect(downloadEmailedLine("ada@example.com")).toBe("We also emailed it to ada@example.com.");
    expect(downloadEmailedLine("  ")).toBe("We also emailed it to you.");
  });
});

describe("checkout errors", () => {
  it("turns a not-ready preview into a waiting message", () => {
    expect(checkoutFailureMessage(409, "Preview is not ready")).toMatch(/isn't ready yet/);
    expect(checkoutFailureMessage(503, "Payments not configured")).toBeNull();
  });
});

describe("preview mapping", () => {
  it("keeps signed-url page numbers and sizes", () => {
    const preview: PreviewResponse = {
      status: "preview_ready",
      totalCents: 7765,
      unitPriceCents: 995,
      billablePages: 3,
      original: {
        url: "https://files.example/original",
        pageCount: 2,
        pages: [
          {
            number: 1,
            widthPt: 612,
            heightPt: 792,
            documentId: "doc-a",
            documentIndex: 0,
            documentName: "a.pdf",
          },
          {
            number: 2,
            widthPt: 500,
            heightPt: 700,
            documentId: "doc-a",
            documentIndex: 0,
            documentName: "a.pdf",
          },
        ],
      },
      translation: {
        url: "https://files.example/preview",
        pageCount: 2,
        pages: [
          {
            number: 1,
            widthPt: 612,
            heightPt: 792,
            documentId: "doc-a",
            documentIndex: 0,
            documentName: "a.pdf",
          },
          {
            number: 2,
            widthPt: 500,
            heightPt: 700,
            documentId: "doc-a",
            documentIndex: 0,
            documentName: "a.pdf",
          },
        ],
        version: 1,
      },
      report: null,
      corrections: [
        {
          id: "c1",
          documentId: "doc-a",
          page: 2,
          quote: null,
          note: "use the passport spelling",
          status: "open",
          createdAt: "2026-10-12T00:00:00.000Z",
        },
      ],
    };
    const shell = previewShellOrder("order-1", preview);
    expect(shell.original.url).toBe("https://files.example/original");
    expect(shell.translation.url).toBe(preview.translation.url);
    expect(shell.filename).toBe("a.pdf");
    const mapped = toPreviewOrder(order(), preview);
    expect(mapped.original.url).toBe("https://files.example/original");
    expect(mapped.original.pages[1]).toEqual({
      page: 2,
      widthPt: 500,
      heightPt: 700,
      documentId: "doc-a",
    });
    expect(mapped.pricing.totalCents).toBe(2985);
    expect(mapped.addonOptions?.map((option) => option.id)).toEqual(["notarization", "mail"]);
    expect(mapped.addonOptions?.map((option) => option.totalCents)).toEqual([1795, 1295]);
    const leaked = order({
      addonOptions: [
        ...order().addonOptions,
        { id: "expedited", label: "Expedited", unitCents: 1200, per: "page", totalCents: 3600 },
      ],
    });
    expect(toPreviewOrder(leaked, preview).addonOptions?.map((option) => option.id)).not.toContain("expedited");
    const evaluationPreview = toPreviewOrder(
      order({ orderType: "evaluation", service: "diploma", evaluationCents: 1995, translationCents: 0 }),
      preview,
    );
    expect(evaluationPreview.addonOptions?.map((option) => option.id)).not.toContain("expedited");
    expect(mapped.pricing.lines).toEqual([
      { label: "3 pages × $9.95", amountCents: 2985 },
    ]);
    expect(mapped.product).toBe("translation");
    expect(mapped.speedLine).toBeNull();
    expect(
      toPreviewOrder(
        order({
          uploadedAt: "2026-10-12T00:00:00.000Z",
          translationReadyAt: "2026-10-12T00:00:04.200Z",
        }),
        preview,
      ).speedLine,
    ).toBe("Translated in 4.2 seconds");
    expect(
      toPreviewOrder(
        order({
          uploadedAt: "2026-10-12T00:00:00.000Z",
          translationReadyAt: "2026-10-12T00:00:30.000Z",
        }),
        preview,
      ).speedLine,
    ).toBeNull();
    expect(
      toPreviewOrder(
        order({
          orderType: "evaluation",
          service: "diploma",
          uploadedAt: "2026-10-12T00:00:00.000Z",
          translationReadyAt: "2026-10-12T00:00:04.200Z",
        }),
        preview,
      ).speedLine,
    ).toBeNull();
    expect(mapped.corrections[0]?.note).toBe("use the passport spelling");
    expect(documentIdForPage(order().documents, 2)).toBe("doc-a");
    expect(documentIdForPage(order().documents, 3)).toBe("doc-b");
  });
});

describe("evaluation prices", () => {
  it("uses API line items instead of the translation page price", () => {
    const diploma = order({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 1990,
      totalCents: 3985,
      billablePages: 2,
      lineItems: [
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
          quantity: 2,
          unitAmountCents: 995,
          amountCents: 1990,
        },
      ],
    });
    expect(diploma.addonOptions.map((option) => option.id)).toEqual(["notarization", "mail"]);
    expect(diploma.expeditedUnit).toBe("order");
    expect(servicePriceLines(diploma)).toEqual([
      { label: "Diploma evaluation", amountCents: 1995 },
      { label: "Certified translation, 2 billable pages", amountCents: 1990 },
    ]);

    const course = order({
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: 2,
      evaluationCents: 7990,
      translationCents: 0,
      totalCents: 7990,
      lineItems: [
        {
          kind: "evaluation",
          description: "Course-by-course evaluation",
          quantity: 2,
          unitAmountCents: 3995,
          amountCents: 7990,
        },
      ],
    });
    expect(course.addonOptions.map((option) => option.id)).toEqual(["notarization", "mail"]);
    expect(course.expeditedUnit).toBe("order");
    expect(servicePriceLines(course)).toEqual([
      { label: "Course-by-course evaluation", amountCents: 7990 },
    ]);
  });

  it("updates both line items and the total when translation is toggled", () => {
    const diploma = order({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      sourceLanguage: "es",
      billablePages: 2,
      evaluationCents: 1995,
      translationCents: 0,
      includeTranslation: false,
      totalCents: 1995,
      lineItems: [
        {
          kind: "evaluation",
          description: "Diploma evaluation",
          quantity: 1,
          unitAmountCents: 1995,
          amountCents: 1995,
        },
      ],
    });
    const added = orderWithTranslationChoice(diploma, true);
    expect(added.includeTranslation).toBe(true);
    expect(added.totalCents).toBe(3985);
    expect(servicePriceLines(added)).toEqual([
      { label: "Diploma evaluation", amountCents: 1995 },
      { label: "Certified translation, 2 billable pages", amountCents: 1990 },
    ]);
    const removed = orderWithTranslationChoice(added, false);
    expect(removed.includeTranslation).toBe(false);
    expect(removed.totalCents).toBe(1995);
    expect(servicePriceLines(removed)).toEqual([{ label: "Diploma evaluation", amountCents: 1995 }]);
    const plain = order();
    expect(orderWithTranslationChoice(plain, true)).toBe(plain);
  });

  it("sends evaluation details to the preview instead of a certification row", () => {
    const diploma = order({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 1,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
      billablePages: 1,
      evaluation: {
        kind: "diploma",
        credentials: [
          {
            applicant: "Ada Lovelace",
            institution: "Example University",
            country: "France",
            credential: "Licence",
            field: "Mathematics",
            dates: "2018–2022",
            usEquivalency: "Bachelor's degree",
            documentsReviewed: ["diploma.pdf"],
          },
        ],
      },
      lineItems: [
        {
          kind: "evaluation",
          description: "Diploma evaluation",
          quantity: 1,
          unitAmountCents: 1995,
          amountCents: 1995,
        },
      ],
    });
    const mapped = toPreviewOrder(diploma, {
      status: "preview_ready",
      totalCents: 1995,
      unitPriceCents: 995,
      billablePages: 1,
      original: { url: "https://files.example/original", pageCount: 1, pages: [] },
      translation: { url: "https://files.example/report", pageCount: 1, pages: [], version: 1 },
      report: { url: "https://files.example/report", pageCount: 1 },
      corrections: [],
    });
    expect(mapped.product).toBe("evaluation");
    expect(mapped.evaluationLine).toBeUndefined();
    const bundle = toPreviewOrder(
      order({
        orderType: "evaluation",
        service: "diploma",
        degreeCount: 1,
        includeTranslation: true,
        billablePages: 1,
        evaluationCents: 1995,
        translationCents: 995,
        totalCents: 2990,
        lineItems: [
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
        ],
      }),
      {
        status: "preview_ready",
        totalCents: 2990,
        unitPriceCents: 995,
        billablePages: 1,
        original: { url: "https://files.example/original", pageCount: 1, pages: [] },
        translation: { url: "https://files.example/preview", pageCount: 1, pages: [], version: 1 },
        report: null,
        corrections: [],
      },
    );
    expect(bundle.product).toBe("translation");
    expect(bundle.pricing.lines).toEqual([{ label: "1 page × $9.95", amountCents: 995 }]);
    expect(bundle.evaluationLine).toEqual({ label: "Diploma evaluation", amountCents: 1995 });
    expect(bundle.pricing.totalCents).toBe(2990);
    expect(bundle.evaluationDetails).toBeUndefined();
    expect(bundle.included).toContain("Signed certificate of accuracy");
    expect(mapped.pricing.lines).toEqual([{ label: "Diploma evaluation", amountCents: 1995 }]);
    expect(mapped.evaluationDetails).toEqual([
      { label: "Credential holder", value: "Ada Lovelace" },
      { label: "School", value: "Example University" },
      { label: "Degree", value: "Licence" },
      { label: "Dates", value: "2018–2022" },
      { label: "U.S. equivalency", value: "Bachelor's degree" },
    ]);
  });
});

describe("download copy", () => {
  it("names an evaluation report and keeps a translation's certificate", () => {
    expect(downloadReadyCopy({ orderType: "evaluation", service: "diploma" })).toEqual({
      title: "Your credential evaluation is ready.",
      primaryTitle: "Evaluation report",
      primaryFile: "evaluation",
      secondary: null,
      again: "Need another credential evaluated?",
    });
    expect(downloadReadyCopy({ orderType: "translation", service: null })).toEqual({
      title: "Your certified translation is ready.",
      primaryTitle: "Certified translation",
      primaryFile: "translation",
      secondary: null,
      again: "Need another document translated?",
    });
  });
});

describe("order hub", () => {
  it("follows the checkout return and otherwise the current step", () => {
    expect(orderHubStep("success", "preview_ready")).toBe("download");
    expect(orderHubStep("cancel", "preview_ready")).toBe("cancel");
    expect(orderHubStep("cancel", "confirmed", { service: "diploma" })).toBe("checkout");
    expect(orderHubStep(null, "quoted")).toBe("quote");
    expect(orderHubStep(null, "needs_review")).toBe("quote");
    expect(orderHubStep(null, "needs_review", { delayed: true, reviewReason: "translation_timeout" })).toBe(
      "processing",
    );
    expect(orderHubStep(null, "needs_review", { reviewReason: "image_quality" })).toBe("quote");
    expect(orderHubStep(null, "draft")).toBe("quote");
    expect(orderHubStep(null, "draft", { service: "diploma" })).toBe("checkout");
    expect(orderHubStep(null, "quoted", { orderType: "evaluation" })).toBe("checkout");
    expect(orderHubStep(null, "processing")).toBe("processing");
    expect(orderHubStep(null, "correction_requested")).toBe("processing");
    expect(orderHubStep(null, "preview_ready")).toBe("processing");
    expect(orderHubStep(null, "preview_ready", { orderType: "evaluation", service: "diploma" })).toBe("checkout");
    expect(
      orderHubStep(null, "preview_ready", {
        orderType: "evaluation",
        service: "diploma",
        includeTranslation: true,
      }),
    ).toBe("processing");
    expect(
      orderHubStep(null, "quoted", { orderType: "evaluation", service: "diploma", includeTranslation: true }),
    ).toBe("quote");
    expect(
      orderHubStep("cancel", "preview_ready", {
        orderType: "evaluation",
        service: "diploma",
        includeTranslation: true,
      }),
    ).toBe("cancel");
    expect(orderHubStep(null, "confirmed", { orderType: "evaluation", service: "diploma" })).toBe("checkout");
    expect(orderHubStep(null, "confirmed")).toBe("processing");
    expect(orderHubStep(null, "paid")).toBe("download");
    expect(orderHubStep(null, "approved")).toBe("download");
    expect(orderHubStep(null, "needs_review", { fulfillment: "awaiting_review" })).toBe("download");
    expect(orderHubStep(null, "correction_requested", { fulfillment: "awaiting_review" })).toBe(
      "download",
    );
    expect(orderHubStep(null, "approved", { fulfillment: "released" })).toBe("download");
    expect(orderHubStep(undefined, undefined)).toBe("processing");
  });

  it("opens a finished translation preview and leaves every other step on this route", () => {
    expect(readyPreviewPath("tok_live", null, { status: "preview_ready" })).toBe("/preview/tok_live");
    expect(
      readyPreviewPath("tok_live", null, { status: "processing", progress: { step: "done" } }),
    ).toBe("/preview/tok_live");
    expect(readyPreviewPath("a b", null, { status: "preview_ready" })).toBe("/preview/a%20b");
    expect(readyPreviewPath("tok", "success", { status: "preview_ready" })).toBeNull();
    expect(readyPreviewPath("tok", "cancel", { status: "preview_ready" })).toBeNull();
    expect(readyPreviewPath("tok", null, { status: "processing", progress: { step: "translating" } })).toBeNull();
    expect(readyPreviewPath("tok", null, { status: "quoted", progress: { step: "done" } })).toBeNull();
    expect(readyPreviewPath("tok", null, { status: "needs_review", progress: { step: "done" } })).toBeNull();
    expect(readyPreviewPath("tok", null, { status: "paid" })).toBeNull();
    expect(
      readyPreviewPath("tok", null, { status: "preview_ready", orderType: "evaluation", service: "diploma" }),
    ).toBeNull();
    expect(
      readyPreviewPath("tok", null, {
        status: "preview_ready",
        orderType: "evaluation",
        service: "diploma",
        includeTranslation: true,
      }),
    ).toBe("/preview/tok");
    expect(readyPreviewPath("", null, { status: "preview_ready" })).toBeNull();
  });
});

describe("parent names", () => {
  it("splits and joins the API parent_names field", () => {
    expect(splitParents("Jorge Luis Ruiz Pérez; Ana María Delgado Soto")).toEqual({
      father: "Jorge Luis Ruiz Pérez",
      mother: "Ana María Delgado Soto",
    });
    expect(joinParents("Ada", "Annabella")).toBe("Ada; Annabella");
  });
});
