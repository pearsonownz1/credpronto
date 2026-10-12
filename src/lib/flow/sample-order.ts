import { WORD_PAGE_RULE } from "@/lib/orders/billing";
import type { CustomerOrder, PreviewPage } from "@/lib/orders/view";

/** Designer sample, shaped like GET /api/orders/[token]. */
export function sampleCustomerOrder(): CustomerOrder {
  return {
    orderId: "CP-24817",
    email: "maria.ruiz@email.com",
    status: "quoted",
    sourceLanguage: "es",
    sourceLanguageConfidence: 0.94,
    targetLanguage: "en",
    languageConfirmed: false,
    documents: [
      {
        id: "acta",
        filename: "acta-nacimiento.pdf",
        pageCount: 1,
        detectedLanguage: "es",
        confidence: 0.94,
        uploadPosition: 1,
        appliedPosition: 1,
      },
      {
        id: "back",
        filename: "IMG_4021.HEIC",
        pageCount: 1,
        detectedLanguage: "es",
        confidence: 0.91,
        uploadPosition: 2,
        appliedPosition: 2,
      },
    ],
    pageOrder: null,
    pages: [],
    billablePages: 2,
    unitPriceCents: 995,
    totalCents: 1990,
    currency: "usd",
    pageRule: WORD_PAGE_RULE,
    etaAt: null,
    reviewReason: null,
    confirmations: [
      field("acta", "full_name", "María Fernanda Ruiz Delgado"),
      field("acta", "date_of_birth", "14 March 1994"),
      field("acta", "parent_names", "Jorge Luis Ruiz Pérez; Ana María Delgado Soto"),
      field("acta", "place_of_birth", "Guadalajara, Jalisco, Mexico"),
      field("acta", "date_format", "MM/DD/YYYY"),
      field("back", "full_name", ""),
      field("back", "date_of_birth", ""),
      field("back", "parent_names", ""),
      field("back", "place_of_birth", ""),
      field("back", "date_format", "MM/DD/YYYY"),
    ],
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
  };
}

/**
 * The sample PDF is three pages. The order has two one-page uploads, so the
 * extra PDF page stays on the second file and every page still has a label.
 */
export function samplePreviewPages(): PreviewPage[] {
  const letter = { widthPt: 612, heightPt: 792 };
  return [
    {
      number: 1,
      ...letter,
      documentId: "acta",
      documentIndex: 0,
      documentName: "acta-nacimiento.pdf",
    },
    {
      number: 2,
      ...letter,
      documentId: "back",
      documentIndex: 1,
      documentName: "IMG_4021.HEIC",
    },
    {
      number: 3,
      ...letter,
      documentId: "back",
      documentIndex: 1,
      documentName: "IMG_4021.HEIC",
    },
  ];
}

function field(
  documentId: string,
  fieldKey: string,
  originalValue: string,
): CustomerOrder["confirmations"][number] {
  return {
    documentId,
    fieldKey,
    originalValue,
    confirmedValue: null,
  };
}
