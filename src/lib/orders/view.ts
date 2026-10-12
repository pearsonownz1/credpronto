import { ADDON_CATALOG, addonOptions, type AddonOption } from "./addons";
import { lineItemForStoredPage, pageRuleForLanguages, type PageLineItem } from "./billing";
import { readOrderProgress, type OrderReadProgress } from "./reading-progress";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "./constants";
import { lineItemsForOrder } from "./evaluation-price";
import { compareCombinedPages } from "./page-order";
import type {
  AddonId,
  ConfirmationRecord,
  DocumentRecord,
  EvaluationLine,
  EvaluationResult,
  EvaluationService,
  OrderRecord,
  OrderType,
  PageOrderBasis,
  PageRecord,
  ShippingAddress,
  StoredPage,
} from "./types";

export type CustomerOrder = {
  orderId: string;
  email: string | null;
  status: string;
  sourceLanguage: string | null;
  sourceLanguageConfidence: number | null;
  targetLanguage: string;
  languageConfirmed: boolean;
  documents: Array<{
    id: string;
    filename: string;
    pageCount: number | null;
    detectedLanguage: string | null;
    confidence: number | null;
    uploadPosition: number;
    appliedPosition: number;
  }>;
  pageOrder: {
    basis: PageOrderBasis;
    pages: Array<
      StoredPage & {
        filename: string;
        id?: string;
        billableUnits?: number | null;
        skip?: boolean;
        skipReason?: string | null;
      }
    >;
  } | null;
  pages: Array<{
    id?: string;
    documentId: string;
    pageNumber: number;
    pageIndex?: number;
    uploadPage: number | null;
    logicalPage: number | null;
    orderHint: string | null;
    qualityScore: number | null;
    qualityFlags: string[];
    qualityMessage: string | null;
    billableUnits?: number | null;
    skip?: boolean;
    skipReason?: string | null;
  }>;
  /** Per-page quote lines. The order total is their billable units at $9.95. */
  pageLineItems: PageLineItem[];
  billablePages: number | null;
  unitPriceCents: number;
  addons: AddonId[];
  addonOptions: AddonOption[];
  shippingAddress: ShippingAddress | null;
  totalCents: number | null;
  currency: string;
  pageRule: string;
  etaAt: string | null;
  reviewReason: string | null;
  confirmations: Array<{
    documentId: string;
    fieldKey: string;
    originalValue: string | null;
    confirmedValue: string | null;
  }>;
  previewVersion: number | null;
  payment: { status: string } | null;
  delivery: { status: string } | null;
  orderType: OrderType;
  service: EvaluationService | null;
  degreeCount: number | null;
  evaluationCents: number | null;
  translationCents: number | null;
  lineItems: EvaluationLine[];
  evaluation: EvaluationResult | null;
  /** Set when the order API reports read progress. */
  progress?: OrderReadProgress;
};

export function toCustomerOrder(input: {
  order: OrderRecord;
  documents: DocumentRecord[];
  pages?: PageRecord[];
  confirmations: ConfirmationRecord[];
  previewVersion: number | null;
  paymentStatus: string | null;
  deliveryStatus: string | null;
  email: string | null;
  addons?: Array<{ id: AddonId }>;
  progress?: unknown;
}): CustomerOrder {
  const confidences = input.documents
    .map((document) => document.confidence)
    .filter((confidence): confidence is number => confidence != null);
  const documents = [...input.documents].sort(
    (a, b) => a.position - b.position || a.filename.localeCompare(b.filename),
  );
  const filenames = new Map(documents.map((document) => [document.id, document.filename]));
  const pages = [...(input.pages ?? [])].sort((a, b) => compareCombinedPages(documents, a, b));
  const pageLineItems = pages.map((page, pageIndex) =>
    lineItemForStoredPage({
      pageIndex,
      text: page.ocrText,
      targetLanguage: input.order.targetLanguage,
      billableUnits: page.billableUnits,
      skip: page.skip,
      skipReason: page.skipReason,
    }),
  );
  const stored = input.order.pageOrder;
  const progress = readOrderProgress(input.progress);

  return {
    orderId: input.order.id,
    email: input.email,
    status: input.order.status,
    sourceLanguage: input.order.sourceLanguage,
    sourceLanguageConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
    targetLanguage: input.order.targetLanguage,
    languageConfirmed: input.order.languageConfirmed,
    documents: documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      pageCount: document.pageCount,
      detectedLanguage: document.detectedLanguage,
      confidence: document.confidence,
      uploadPosition: document.position,
      appliedPosition: document.appliedPosition ?? document.position,
    })),
    pageOrder: stored
      ? {
          basis: stored.basis,
          pages: stored.pages.map((page) => ({
            ...page,
            filename: filenames.get(page.documentId) ?? "",
          })),
        }
      : null,
    pages: pages.map((page, pageIndex) => ({
      id: page.id,
      documentId: page.documentId,
      pageNumber: page.pageNumber,
      pageIndex,
      uploadPage: page.uploadPage,
      logicalPage: page.logicalPage,
      orderHint: page.orderHint,
      qualityScore: page.qualityScore,
      qualityFlags: page.qualityFlags,
      qualityMessage: page.qualityMessage,
      ...(page.billableUnits != null ? { billableUnits: page.billableUnits } : {}),
      ...(typeof page.skip === "boolean" ? { skip: page.skip } : {}),
      ...(page.skipReason ? { skipReason: page.skipReason } : {}),
    })),
    pageLineItems,
    billablePages: input.order.billablePages,
    unitPriceCents: input.order.unitPriceCents,
    addons: [...(input.addons ?? [])]
      .sort(
        (a, b) =>
          ADDON_CATALOG.findIndex((item) => item.id === a.id) -
          ADDON_CATALOG.findIndex((item) => item.id === b.id),
      )
      .map((item) => item.id),
    addonOptions: addonOptions(input.order.billablePages),
    shippingAddress: input.order.shippingAddress,
    totalCents: input.order.totalCents,
    currency: input.order.currency,
    pageRule: pageRuleForLanguages([
      input.order.sourceLanguage,
      ...input.documents.map((document) => document.detectedLanguage),
    ]),
    etaAt: input.order.etaAt,
    reviewReason: input.order.reviewReason,
    confirmations: input.confirmations.map((field) => ({
      documentId: field.documentId,
      fieldKey: field.fieldKey,
      originalValue: field.originalValue,
      confirmedValue: field.confirmedValue,
    })),
    previewVersion: input.previewVersion,
    payment: input.paymentStatus ? { status: input.paymentStatus } : null,
    delivery: input.deliveryStatus ? { status: input.deliveryStatus } : null,
    orderType: input.order.orderType,
    service: input.order.service,
    degreeCount: input.order.degreeCount,
    evaluationCents: input.order.evaluationCents,
    translationCents: input.order.translationCents,
    lineItems: lineItemsForOrder(input.order),
    evaluation: publicEvaluation(input.order.evaluationResult),
    ...(progress ? { progress } : {}),
  };
}

function publicEvaluation(result: EvaluationResult | null): EvaluationResult | null {
  if (!result) return null;
  const copy = { ...result };
  delete copy.pageCount;
  return copy;
}

export type PreviewPage = {
  number: number;
  widthPt: number;
  heightPt: number;
  documentId: string;
  documentIndex: number;
  documentName: string;
};

export type PreviewResponse = {
  status: string;
  totalCents: number | null;
  unitPriceCents: number;
  billablePages: number | null;
  original: { url: string; pageCount: number; pages: PreviewPage[] };
  translation: { url: string; pageCount: number; pages: PreviewPage[]; version: number };
  report: { url: string; pageCount: number } | null;
  corrections: Array<{
    id: string;
    documentId: string | null;
    page: number | null;
    quote: string | null;
    note: string | null;
    status: string;
    createdAt: string;
  }>;
};

export function previewPages(
  documents: Array<Pick<DocumentRecord, "id" | "filename" | "position">>,
  pages: Array<PageRecord & { number: number }>,
): PreviewPage[] {
  const ordered = [...documents].sort(
    (a, b) => a.position - b.position || a.filename.localeCompare(b.filename),
  );
  const meta = new Map(
    ordered.map((document, index) => [
      document.id,
      { documentIndex: index, documentName: document.filename },
    ]),
  );

  return pages.map((page) => {
    const document = meta.get(page.documentId);
    return {
      number: page.number,
      widthPt: page.widthPt ?? LETTER_WIDTH_PT,
      heightPt: page.heightPt ?? LETTER_HEIGHT_PT,
      documentId: page.documentId,
      documentIndex: document?.documentIndex ?? 0,
      documentName: document?.documentName ?? "",
    };
  });
}
