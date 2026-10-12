import { serviceCents } from "@/lib/orders/addons";
import {
  languageLabel,
  languagesEqual,
  sourceLanguageChoices,
  targetLanguageChoices,
} from "@/lib/orders/languages";
import type { EvaluationLine } from "@/lib/orders/types";
import type { CustomerOrder, PreviewResponse } from "@/lib/orders/view";
import {
  formatMoney,
  type PreviewOrder,
} from "@/components/preview/preview-order";

export const LANGUAGE_PENDING = "We'll confirm the language";

export const UPLOAD_ORDER_NOTE = "We kept the pages in the order you uploaded them.";

const PREVIEW_INCLUDED = [
  "Clean PDF, no watermark",
  "Signed certificate of accuracy",
  "Meets USCIS certification rules",
  "Emailed and downloadable",
];

const EVALUATION_INCLUDED = [
  "Watermark removed after payment",
  "Signed by a credential evaluator",
  "Emailed and downloadable",
];

export function displayedPageRule(order: { pageRule: string }): string {
  return order.pageRule;
}

/** Confirm accepts `sourceLanguage` only while the order is quoted. */
export function canSetSourceLanguage(order: { status: string }): boolean {
  return order.status === "quoted";
}

export function languageChoices() {
  return sourceLanguageChoices();
}

export function targetChoices() {
  return targetLanguageChoices();
}

/** True when the detected source and the order target are the same language. */
export function showTargetLanguagePicker(order: {
  sourceLanguage: string | null;
  targetLanguage: string;
}): boolean {
  return languagesEqual(order.sourceLanguage, order.targetLanguage);
}

/**
 * Continue opens confirm only for a quoted order that has a price: line items
 * (or billable pages that price as a line) and a total. `needs_review` stays
 * on the quote, including an English source with no line items.
 */
export function canOpenConfirm(order: {
  status: string;
  lineItems: EvaluationLine[];
  billablePages: number | null;
  unitPriceCents: number;
  totalCents: number | null;
}): boolean {
  return order.status === "quoted" && order.totalCents != null && servicePriceLines(order).length > 0;
}

/** Shown when PATCH /api/orders/[token] is not available yet. */
export const TARGET_LANGUAGE_REVIEW_MESSAGE =
  "We'll review this order and email you a quote.";

/**
 * A successful target-language update refetches the order. 404 and 405 mean
 * the route is not there yet, so the quote stays with a reviewer.
 */
export function settleTargetLanguageUpdate(
  error: { status: number; message: string } | null,
): { refetch: boolean; message: string | null } {
  if (!error) return { refetch: true, message: null };
  if (error.status === 404 || error.status === 405) {
    return { refetch: false, message: TARGET_LANGUAGE_REVIEW_MESSAGE };
  }
  return {
    refetch: false,
    message: error.message || "We couldn't update the language.",
  };
}

export function languageLine(order: {
  sourceLanguage: string | null;
  targetLanguage: string;
}): string {
  if (!order.sourceLanguage) return LANGUAGE_PENDING;
  const target = order.targetLanguage
    ? languageLabel(order.targetLanguage)
    : "English";
  return `${languageLabel(order.sourceLanguage)} → ${target}`;
}

export function totalLabel(cents: number | null): string {
  if (cents == null) return "Pending";
  return formatMoney(cents);
}

export type ServicePriceLine = {
  label: string;
  amountCents: number;
};

/** Evaluation orders use API line items. Translations stay pages × the page price. */
export function servicePriceLines(order: {
  lineItems: EvaluationLine[];
  billablePages: number | null;
  unitPriceCents: number;
}): ServicePriceLine[] {
  if (order.lineItems.length > 0) {
    return order.lineItems.map((item) => ({
      label: priceLineLabel(item),
      amountCents: item.amountCents,
    }));
  }
  const pages = order.billablePages ?? 0;
  if (pages <= 0) return [];
  return [
    {
      label: `${pages} pages × ${formatMoney(order.unitPriceCents)}`,
      amountCents: pages * order.unitPriceCents,
    },
  ];
}

function priceLineLabel(item: EvaluationLine): string {
  const unit = formatMoney(item.unitAmountCents);
  if (item.kind === "evaluation") {
    const noun = item.quantity === 1 ? "degree" : "degrees";
    return `${item.description} · ${item.quantity} ${noun} × ${unit}`;
  }
  const noun = item.quantity === 1 ? "page" : "pages";
  return `${item.description} · ${item.quantity} ${noun} × ${unit}`;
}

export type DownloadPhase = "confirming" | "certifying" | "ready";

export function downloadPhase(order: {
  status: string;
  payment: { status: string } | null;
  delivery: { status: string } | null;
}): DownloadPhase {
  const paid =
    order.status === "paid" ||
    order.status === "approved" ||
    order.status === "delivered" ||
    order.payment?.status === "paid" ||
    order.payment?.status === "paid_test";
  if (!paid) return "confirming";
  const delivery = order.delivery?.status;
  if (
    delivery === "approved" ||
    delivery === "delivered" ||
    order.status === "approved" ||
    order.status === "delivered"
  ) {
    return "ready";
  }
  return "certifying";
}

export type OrderHubStep = "download" | "preview" | "quote" | "processing" | "cancel";

/** Which screen `/order/[token]` shows for a checkout return or order status. */
export function orderHubStep(
  checkout: string | null | undefined,
  status: string | null | undefined,
): OrderHubStep {
  if (checkout === "success") return "download";
  if (checkout === "cancel") return "cancel";
  if (
    status === "paid" ||
    status === "approved" ||
    status === "delivered"
  ) {
    return "download";
  }
  if (status === "preview_ready") return "preview";
  if (
    status === "quoted" ||
    status === "needs_review" ||
    status === "draft" ||
    status === "failed"
  ) {
    return "quote";
  }
  return "processing";
}

export function checkoutFailureMessage(status: number, message: string): string | null {
  if (status === 409 && /preview is not ready/i.test(message)) {
    return "Your preview isn't ready yet. You can pay as soon as the translation is ready to review.";
  }
  return null;
}

export function splitParents(value: string): { father: string; mother: string } {
  const [father, ...rest] = value.split(";");
  return {
    father: (father ?? "").trim(),
    mother: rest.join(";").trim(),
  };
}

export function joinParents(father: string, mother: string): string {
  return [father.trim(), mother.trim()].filter(Boolean).join("; ");
}

export function documentIdForPage(
  documents: Array<{ id: string; pageCount: number | null }>,
  page: number,
): string | null {
  let start = 1;
  for (const document of documents) {
    const count = document.pageCount ?? 0;
    if (count > 0 && page >= start && page < start + count) return document.id;
    start += Math.max(count, 0);
  }
  return documents.length === 1 ? documents[0].id : null;
}

export function toPreviewOrder(
  order: CustomerOrder,
  preview: PreviewResponse,
): PreviewOrder {
  const pages = preview.billablePages ?? preview.original.pageCount;
  const mapPages = (input: PreviewResponse["original"]["pages"]) =>
    input.map((page) => ({
      page: page.number,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      documentId: page.documentId,
    }));

  return {
    id: order.orderId,
    status: "preview_ready",
    sourceLanguage: order.sourceLanguage
      ? languageLabel(order.sourceLanguage)
      : LANGUAGE_PENDING,
    targetLanguage: order.targetLanguage
      ? languageLabel(order.targetLanguage)
      : "English",
    filename: order.documents[0]?.filename ?? "document.pdf",
    pageCount: preview.original.pageCount,
    original: {
      url: preview.original.url,
      subtitle: "Original",
      pages: mapPages(preview.original.pages),
    },
    translation: {
      url: preview.translation.url,
      subtitle: "English · watermarked preview",
      pages: mapPages(preview.translation.pages),
    },
    product: order.orderType === "evaluation" ? "evaluation" : "translation",
    pricing: {
      perPageCents: preview.unitPriceCents,
      pages,
      certificationIncluded: true,
      totalCents:
        serviceCents({
          billablePages: preview.billablePages,
          unitPriceCents: preview.unitPriceCents,
          service: order.service,
          evaluationCents: order.evaluationCents,
          translationCents: order.translationCents,
        }) ??
        preview.totalCents ??
        0,
      lines: servicePriceLines(order),
    },
    addonOptions: order.addonOptions,
    addons: order.addons,
    shippingAddress: order.shippingAddress,
    included: order.orderType === "evaluation" ? EVALUATION_INCLUDED : PREVIEW_INCLUDED,
    corrections: preview.corrections
      .filter((correction) => correction.page != null)
      .map((correction) => ({
        id: correction.id,
        page: correction.page ?? 1,
        passage: correction.quote,
        note: correction.note ?? "",
        status: "sent" as const,
        label: correction.note?.trim() || "Correction",
        detail: correction.status,
      })),
  };
}
