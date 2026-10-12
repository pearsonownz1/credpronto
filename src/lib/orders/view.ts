import { pageRuleForLanguages } from "./billing";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "./constants";
import type { ConfirmationRecord, DocumentRecord, OrderRecord, PageRecord } from "./types";

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
  }>;
  billablePages: number | null;
  unitPriceCents: number;
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
};

export function toCustomerOrder(input: {
  order: OrderRecord;
  documents: DocumentRecord[];
  confirmations: ConfirmationRecord[];
  previewVersion: number | null;
  paymentStatus: string | null;
  deliveryStatus: string | null;
  email: string | null;
}): CustomerOrder {
  const confidences = input.documents
    .map((document) => document.confidence)
    .filter((confidence): confidence is number => confidence != null);

  return {
    orderId: input.order.id,
    email: input.email,
    status: input.order.status,
    sourceLanguage: input.order.sourceLanguage,
    sourceLanguageConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
    targetLanguage: input.order.targetLanguage,
    languageConfirmed: input.order.languageConfirmed,
    documents: input.documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      pageCount: document.pageCount,
      detectedLanguage: document.detectedLanguage,
      confidence: document.confidence,
    })),
    billablePages: input.order.billablePages,
    unitPriceCents: input.order.unitPriceCents,
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
  };
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
