import { ADDON_CATALOG, EXPEDITED_UNIT, addonOptions, type AddonOption } from "./addons";
import { lineItemForStoredPage, pageRuleForLanguages, type PageLineItem } from "./billing";
import { progressForOrder, type PublicOrderProgress } from "./reading-progress";
import { isPreviewDelayed } from "./translation-watch";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "./constants";
import { customerServiceQuote, lineItemsForOrder } from "./evaluation-price";
import { customerEvaluationResult, customerReviewReason } from "./equivalency";
import { fulfillmentState, type FulfillmentState } from "./release-decision";
import { detectDocumentTitle, deliveryDocumentName } from "./download-name";
import { bundleTranslationReady } from "./final-file";
import { storedTimestamp, uploadOrCreatedAt } from "./speed-line";
import { compareCombinedPages } from "./page-order";
import { customerEvalStatus, type EvalStatus } from "../evalStatus";
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
  /**
   * Detected billable page count. Read-only: clients do not send a page quantity.
   * Show this as "Pages: N". A translation line is this count times $9.95.
   */
  billablePages: number | null;
  unitPriceCents: number;
  addons: AddonId[];
  addonOptions: AddonOption[];
  /** Unit stored for older Expedited purchases. New orders do not offer it. */
  expeditedUnit: typeof EXPEDITED_UNIT;
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
  /** Credentials to evaluate. New orders accept an integer from 1 to 5. */
  degreeCount: number | null;
  evaluationCents: number | null;
  translationCents: number | null;
  /** True when this evaluation includes certified translation. */
  includeTranslation: boolean;
  /**
   * Paid bundle whose certified translation packet is stored.
   * The evaluation tracker can still be in review.
   */
  translationReady?: boolean;
  /** Cents to add if the customer opts in. Null when a translation cannot be added. */
  translationOfferCents: number | null;
  lineItems: EvaluationLine[];
  evaluation: EvaluationResult | null;
  progress: PublicOrderProgress;
  /** True after 4 minutes with no preview, including a translation timeout in review. */
  delayed: boolean;
  /** When checkout settled. Null until the order is paid. */
  paidAt: string | null;
  /** First upload, or the order created time when no upload time is stored. */
  uploadedAt?: string | null;
  /** When the first ready translation preview was generated. */
  translationReadyAt?: string | null;
  /** When the finished file was delivered. Null until then. */
  deliveredAt?: string | null;
  /** `released` after certification. `awaiting_review` while a paid order is still with staff. */
  fulfillment: FulfillmentState | null;
  /**
   * `orders.evaluation_status`. Null when that column is absent or not a known status.
   * The tracker falls back to under review for a paid evaluation in that case.
   */
  evaluationStatus?: EvalStatus | null;
  /** Per-step ISO timestamps from `under_review_at` and the other status `_at` columns. */
  evaluationStatusAt?: Partial<Record<EvalStatus, string>>;
  /** Detected document title, or a readable form of the upload name. */
  documentTitle: string;
};

export function toCustomerOrder(input: {
  order: OrderRecord;
  documents: DocumentRecord[];
  pages?: PageRecord[];
  confirmations: ConfirmationRecord[];
  previewVersion: number | null;
  paymentStatus: string | null;
  deliveryStatus: string | null;
  deliveredAt?: string | null;
  translationReadyAt?: string | null;
  email: string | null;
  addons?: Array<{ id: AddonId }>;
  translationOutputs?: readonly unknown[];
  now?: number;
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
  const documentTitle = deliveryDocumentName({
    detectedTitle: detectDocumentTitle({
      outputs: input.translationOutputs,
      ocrTexts: pages.map((page) => page.ocrText),
    }),
    documentNames: documents.map((document) => document.filename),
  }).title;
  const quoted = customerServiceQuote({ ...input.order, documents: input.documents });
  const evaluationCents = quoted.evaluationCents;
  const translationCents = quoted.translationCents;
  const unitPriceCents = quoted.unitPriceCents;

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
    pageLineItems: quoted.evaluation ? [] : pageLineItems,
    billablePages: quoted.billablePages,
    unitPriceCents,
    addons: [...(input.addons ?? [])]
      .sort(
        (a, b) =>
          ADDON_CATALOG.findIndex((item) => item.id === a.id) -
          ADDON_CATALOG.findIndex((item) => item.id === b.id),
      )
      .map((item) => item.id),
    addonOptions: addonOptions(input.order.billablePages, input.order),
    expeditedUnit: EXPEDITED_UNIT,
    shippingAddress: input.order.shippingAddress,
    totalCents: quoted.totalCents,
    currency: input.order.currency,
    pageRule: pageRuleForLanguages([
      input.order.sourceLanguage,
      ...input.documents.map((document) => document.detectedLanguage),
    ]),
    etaAt: input.order.etaAt,
    reviewReason: customerReviewReason(input.order.reviewReason),
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
    evaluationCents,
    translationCents,
    includeTranslation: quoted.includeTranslation,
    translationReady: bundleTranslationReady({
      includeTranslation: quoted.includeTranslation,
      status: input.order.status,
      paymentStatus: input.paymentStatus,
      finalTranslationPath: input.order.finalTranslationPath,
    }),
    translationOfferCents: quoted.translationOfferCents,
    lineItems: lineItemsForOrder({
      service: input.order.service,
      degreeCount: input.order.degreeCount,
      evaluationCents,
      translationCents,
      billablePages: quoted.billablePages,
    }),
    evaluation: customerEvaluation(
      input.order,
      input.deliveryStatus,
      documents.map((document) => document.filename),
    ),
    progress: progressForOrder(input.order, input.deliveryStatus),
    paidAt: input.order.paidAt,
    uploadedAt: uploadOrCreatedAt(input.documents, input.order.createdAt),
    translationReadyAt: storedTimestamp(input.translationReadyAt),
    deliveredAt: storedTimestamp(input.deliveredAt),
    fulfillment: fulfillmentState(input.order),
    ...customerEvalStatus(input.order),
    documentTitle,
    delayed: isPreviewDelayed({
      status: input.order.status,
      previewVersion: input.previewVersion,
      updatedAt: input.order.updatedAt,
      progress: input.order.progress,
      now: input.now ?? Date.now(),
      reviewReason: input.order.reviewReason,
    }),
  };
}

function publicEvaluation(result: EvaluationResult | null): EvaluationResult | null {
  if (!result) return null;
  const copy = customerEvaluationResult(result);
  delete copy.pageCount;
  return copy;
}

function evaluationDelivered(
  order: { status: string; orderType: string; serviceType: string; service: EvaluationService | null },
  deliveryStatus: string | null,
): boolean {
  const evaluation =
    order.orderType === "evaluation" || order.serviceType === "evaluation" || order.service != null;
  return evaluation && (order.status === "delivered" || deliveryStatus === "delivered");
}

/** Stored report when one exists. After delivery, a staff PDF still leaves this non-null. */
function customerEvaluation(
  order: OrderRecord,
  deliveryStatus: string | null,
  filenames: readonly string[],
): EvaluationResult | null {
  const shown = publicEvaluation(order.evaluationResult);
  if (shown || !evaluationDelivered(order, deliveryStatus)) return shown;
  return deliveredEvaluationInfo(order.service, filenames);
}

function deliveredEvaluationInfo(
  service: EvaluationService | null,
  filenames: readonly string[],
): EvaluationResult {
  const documentsReviewed = filenames.map((name) => name.trim()).filter((name) => name.length > 0);
  if (service === "course_by_course") {
    return {
      kind: "course_by_course",
      applicant: "",
      institution: "",
      country: "",
      credential: "",
      years: [],
      totalHours: 0,
      gpa: 0,
      gradeScale: "",
    };
  }
  return {
    kind: "diploma",
    credentials:
      documentsReviewed.length > 0
        ? [
            {
              applicant: "",
              institution: "",
              country: "",
              credential: "",
              field: "",
              dates: "",
              usEquivalency: "",
              documentsReviewed,
            },
          ]
        : [],
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
