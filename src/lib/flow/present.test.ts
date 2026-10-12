import { describe, expect, it } from "vitest";
import { CJK_PAGE_RULE, WORD_PAGE_RULE } from "@/lib/orders/billing";
import type { CustomerOrder, PreviewResponse } from "@/lib/orders/view";
import {
  LANGUAGE_PENDING,
  canSetSourceLanguage,
  certifiedDownloadName,
  checkoutEmail,
  checkoutFailureMessage,
  downloadBase,
  originalDownloadName,
  displayedPageRule,
  customerEmail,
  documentIdForPage,
  downloadPhase,
  joinParents,
  languageLine,
  orderHubStep,
  retakeDocumentIds,
  retakeInstructions,
  retakePages,
  splitParents,
  toPreviewOrder,
  totalLabel,
} from "./present";

function order(patch: Partial<CustomerOrder> = {}): CustomerOrder {
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
    lineItems: [],
    evaluation: null,
    ...patch,
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
});

describe("page rule", () => {
  it("renders the order pageRule for word and CJK billing", () => {
    expect(displayedPageRule(order())).toBe(WORD_PAGE_RULE);
    const cjk = order({
      sourceLanguage: "zh",
      pageRule: CJK_PAGE_RULE,
    });
    expect(displayedPageRule(cjk)).toBe(CJK_PAGE_RULE);
    expect(displayedPageRule(cjk)).toContain("400 units");
    expect(displayedPageRule(cjk)).not.toBe(WORD_PAGE_RULE);
  });
});

describe("download phase", () => {
  it("waits for payment, then certification, then the files", () => {
    expect(downloadPhase(order({ status: "preview_ready" }))).toBe("confirming");
    expect(
      downloadPhase(
        order({
          status: "paid",
          payment: { status: "paid" },
          delivery: { status: "pending" },
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
  });
});

describe("checkout errors", () => {
  it("turns a not-ready preview into a waiting message", () => {
    expect(checkoutFailureMessage(409, "Preview is not ready")).toMatch(/isn't ready yet/);
    expect(checkoutFailureMessage(503, "Payments not configured")).toBeNull();
  });
});

describe("download names", () => {
  it("builds the certified name from the document base and keeps the original name", () => {
    expect(downloadBase("acta-nacimiento.pdf")).toBe("acta-nacimiento");
    expect(downloadBase("IMG_4021.HEIC")).toBe("IMG_4021");
    expect(certifiedDownloadName("acta-nacimiento.pdf")).toBe(
      "acta-nacimiento-EN-certified.pdf",
    );
    expect(certifiedDownloadName("diploma.name.pdf")).toBe("diploma.name-EN-certified.pdf");
    expect(originalDownloadName("IMG_4021.HEIC")).toBe("IMG_4021.HEIC");
    expect(certifiedDownloadName("  ")).toBe("document-EN-certified.pdf");
    expect(originalDownloadName(null)).toBe("");
  });
});

describe("checkout email", () => {
  it("prefers the order address, then the signed-in account", () => {
    expect(checkoutEmail("ada@example.com", "other@example.com")).toBe("ada@example.com");
    expect(checkoutEmail("  ", "ada@example.com")).toBe("ada@example.com");
    expect(checkoutEmail(null, " ada@example.com ")).toBe("ada@example.com");
    expect(checkoutEmail(null, null)).toBe("");
    expect(checkoutEmail(undefined, "  ")).toBe("");
  });
});

describe("preview mapping", () => {
  it("keeps signed-url page numbers and sizes", () => {
    const preview: PreviewResponse = {
      status: "preview_ready",
      totalCents: 2985,
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
    const mapped = toPreviewOrder(order(), preview);
    expect(mapped.original.url).toBe("https://files.example/original");
    expect(mapped.original.pages[1]).toEqual({
      page: 2,
      widthPt: 500,
      heightPt: 700,
      documentId: "doc-a",
      documentIndex: 0,
      documentName: "a.pdf",
    });
    expect(mapped.pricing.totalCents).toBe(2985);
    expect(mapped.corrections[0]?.note).toBe("use the passport spelling");
    expect(mapped.corrections[0]?.documentId).toBe("doc-a");
    expect(mapped.corrections[0]?.documentName).toBe("a.pdf");
    expect(customerEmail(order())).toBe("ada@example.com");
    expect(customerEmail({ email: "  " })).toBe("");
    expect(customerEmail({ email: null })).toBe("");
    expect(documentIdForPage(order().documents, 2)).toBe("doc-a");
    expect(documentIdForPage(order().documents, 3)).toBe("doc-b");
  });
});

describe("image quality retake", () => {
  it("renders flags in pageOrder and ignores the pages array order", () => {
    const pages = retakePages(
      order({
        reviewReason: "image_quality",
        pageOrder: {
          basis: "logical",
          pages: [
            {
              documentId: "doc-b",
              filename: "scan-page-1.jpg",
              uploadPosition: 2,
              appliedPosition: 1,
              uploadPage: 1,
              appliedPage: 1,
              logicalPage: 1,
              hint: "page 1/2",
              confidence: 0.9,
            },
            {
              documentId: "doc-a",
              filename: "scan-page-2.jpg",
              uploadPosition: 1,
              appliedPosition: 2,
              uploadPage: 1,
              appliedPage: 1,
              logicalPage: 2,
              hint: "page 2/2",
              confidence: 0.9,
            },
          ],
        },
        pages: [
          {
            documentId: "doc-a",
            pageNumber: 1,
            uploadPage: 1,
            logicalPage: 2,
            orderHint: "page 2/2",
            qualityScore: 0.3,
            qualityFlags: ["too_dark", "blurry", "not-a-flag"],
            qualityMessage: "It looks blurry.",
          },
          {
            documentId: "doc-b",
            pageNumber: 1,
            uploadPage: 1,
            logicalPage: 1,
            orderHint: "page 1/2",
            qualityScore: 0.7,
            qualityFlags: ["glare", "cropped"],
            qualityMessage: "The crop cuts off the text.",
          },
        ],
      }),
    );

    expect(pages.map((page) => page.filename)).toEqual(["scan-page-1.jpg", "scan-page-2.jpg"]);
    expect(pages[0]?.flags).toEqual(["cropped", "glare"]);
    expect(pages[0]?.detail).toContain("printed page 1");
    expect(pages[0]?.detail).toContain("moved from the upload order");
    expect(pages[1]?.flags).toEqual(["blurry", "too_dark"]);
    expect(retakeInstructions(pages)).toEqual([
      "The crop cuts off the text.",
      "It looks blurry.",
    ]);
    expect(retakeDocumentIds(pages)).toEqual(["doc-b", "doc-a"]);
  });

  it("keeps analyzed pages when pageOrder is still empty", () => {
    const pages = retakePages(
      order({
        pages: [
          {
            documentId: "doc-a",
            pageNumber: 1,
            uploadPage: 1,
            logicalPage: null,
            orderHint: null,
            qualityScore: 0.4,
            qualityFlags: ["unreadable_fields"],
            qualityMessage: null,
          },
        ],
      }),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]?.filename).toBe("a.pdf");
    expect(pages[0]?.flags).toEqual(["unreadable_fields"]);
    expect(retakeInstructions(pages)[0]).toContain("even light");
    expect(retakeDocumentIds(pages)).toEqual(["doc-a"]);
  });
});

describe("order hub", () => {
  it("follows the checkout return and otherwise the current step", () => {
    expect(orderHubStep("success", "preview_ready")).toBe("download");
    expect(orderHubStep("cancel", "preview_ready")).toBe("cancel");
    expect(orderHubStep(null, "quoted")).toBe("quote");
    expect(orderHubStep(null, "needs_review")).toBe("quote");
    expect(orderHubStep(null, "draft")).toBe("quote");
    expect(orderHubStep(null, "processing")).toBe("processing");
    expect(orderHubStep(null, "correction_requested")).toBe("processing");
    expect(orderHubStep(null, "preview_ready")).toBe("preview");
    expect(orderHubStep(null, "paid")).toBe("download");
    expect(orderHubStep(null, "approved")).toBe("download");
    expect(orderHubStep(undefined, undefined)).toBe("processing");
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
