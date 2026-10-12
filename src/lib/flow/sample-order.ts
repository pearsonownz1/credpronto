import { addonOptions } from "@/lib/orders/addons";
import { WORD_PAGE_RULE } from "@/lib/orders/billing";
import type { CustomerOrder } from "@/lib/orders/view";

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
    pageLineItems: [],
    billablePages: 2,
    unitPriceCents: 995,
    addons: [],
    addonOptions: addonOptions(2),
    shippingAddress: null,
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
    includeTranslation: false,
    translationOfferCents: null,
    lineItems: [],
    evaluation: null,
    progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
    delayed: false,
  };
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
