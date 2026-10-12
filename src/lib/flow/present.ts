import { serviceCents } from "@/lib/orders/addons";
import { TRANSLATION_TIMEOUT_REASON } from "@/lib/orders/translation-failure";
import {
  languageLabel,
  languagesEqual,
  sourceLanguageChoices,
  targetLanguageChoices,
} from "@/lib/orders/languages";
import { skipPageNote, sumQuotedBillable } from "@/lib/orders/skip-pages";
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

export const QUOTE_BILLING_NOTE =
  "Billed by translatable text, about 250 words (or 1,000 characters) per page. English pages and shipping labels are free.";

/** Quote-screen fine print. The order still carries pageRule for other clients. */
export function displayedPageRule(order: { pageRule: string }): string {
  void order.pageRule;
  return QUOTE_BILLING_NOTE;
}

export type QuoteCounts = {
  files: number;
  pages: number;
  billable: number;
};

type CountLine = {
  billableUnits?: number | null;
  skip?: boolean;
};

/** Physical pages the quote is counting. Page records win when they cover the ordered pages. */
export function quoteCountLines(order: {
  documents: Array<{ pageCount: number | null }>;
  pages: CountLine[];
  pageOrder: { pages: CountLine[] } | null;
}): CountLine[] {
  const lines = quoteIndexSource(order);
  if (lines.length > 0) return lines;
  const count = order.documents.reduce((sum, document) => sum + (document.pageCount ?? 0), 0);
  return Array.from({ length: count }, () => ({}));
}

/** The line-item list `skipPages` indexes. Empty when the quote only has a page-count fallback. */
function quoteIndexSource(order: {
  pages: CountLine[];
  pageOrder: { pages: CountLine[] } | null;
}): CountLine[] {
  const analyzed = order.pages;
  const ordered = order.pageOrder?.pages ?? [];
  if (analyzed.length > 0 && analyzed.length >= ordered.length) return analyzed;
  if (ordered.length > 0) return ordered;
  if (analyzed.length > 0) return analyzed;
  return [];
}

export function quoteCounts(order: {
  documents: Array<{ pageCount: number | null }>;
  pages: CountLine[];
  pageOrder: { pages: CountLine[] } | null;
}): QuoteCounts {
  const lines = quoteCountLines(order);
  return {
    files: order.documents.length,
    pages: lines.length,
    billable: sumQuotedBillable(lines),
  };
}

export function quoteSummaryLabel(counts: QuoteCounts): string {
  const files = `${counts.files} ${counts.files === 1 ? "file" : "files"}`;
  const pages = `${counts.pages} ${counts.pages === 1 ? "page" : "pages"}`;
  return `${files}, ${pages}, ${counts.billable} billable`;
}

/** Billable pages for one file. The quote does not show a physical page total. */
export function fileCountLabel(billable: number): string {
  const noun = billable === 1 ? "page" : "pages";
  return `${billable} billable ${noun}`;
}

export function billablePriceLabel(pages: number, unitPriceCents: number): string {
  const noun = pages === 1 ? "page" : "pages";
  return `${pages} ${noun} × ${formatMoney(unitPriceCents)}`;
}

export type QuotePageRow = {
  key: string;
  documentId: string;
  /** Index into the line items `skipPages` addresses. Missing when this row is not one of those lines. */
  pageIndex?: number;
  pageId?: string;
  filename: string;
  logicalPage: number | null;
  appliedPage: number;
  hint: string | null;
  moved: boolean;
  billableUnits?: number | null;
  skip?: boolean;
  skipReason?: string | null;
};

export type QuoteFileGroup = {
  id: string;
  filename: string;
  /** Null when the file has no page rows and no page count. */
  pages: number | null;
  billable: number;
  rows: QuotePageRow[];
};

export function quotePageRows(order: CustomerOrder): QuotePageRow[] {
  const names = new Map(order.documents.map((document) => [document.id, document.filename]));
  const indexingPages =
    order.pages.length > 0 && order.pages.length >= (order.pageOrder?.pages.length ?? 0);
  const ordered = order.pageOrder && order.pageOrder.pages.length > 1 ? order.pageOrder.pages : null;
  if (ordered) {
    return ordered.map((page, index) => {
      const matchIndex = order.pages.findIndex((item) => pagesMatch(item, page));
      const match = matchIndex >= 0 ? order.pages[matchIndex] : undefined;
      const counted = indexingPages ? match : page;
      const fallback = indexingPages ? page : match;
      return {
        key: `${page.documentId}-${page.uploadPage}-${page.appliedPage}-${index}`,
        documentId: page.documentId,
        pageIndex: indexingPages ? (matchIndex >= 0 ? matchIndex : undefined) : index,
        pageId: match?.id ?? page.id,
        filename: page.filename || names.get(page.documentId) || "Page",
        logicalPage: page.logicalPage,
        appliedPage: page.appliedPage,
        hint: page.hint,
        moved: page.uploadPosition !== page.appliedPosition || page.uploadPage !== page.appliedPage,
        billableUnits: counted?.billableUnits ?? fallback?.billableUnits,
        skip: counted?.skip ?? fallback?.skip,
        skipReason: counted?.skipReason ?? fallback?.skipReason,
      };
    });
  }

  const detailed = order.pages.some(
    (page) => page.id != null || page.billableUnits != null || typeof page.skip === "boolean",
  );
  if (!detailed) return [];
  return order.pages.map((page, index) => ({
    key: page.id ?? `${page.documentId}-${page.pageNumber}-${index}`,
    documentId: page.documentId,
    pageIndex: index,
    pageId: page.id,
    filename: names.get(page.documentId) || "Page",
    logicalPage: page.logicalPage,
    appliedPage: page.pageNumber,
    hint: page.orderHint,
    moved: false,
    billableUnits: page.billableUnits,
    skip: page.skip,
    skipReason: page.skipReason,
  }));
}

function rowsHaveBillableUnits(rows: QuotePageRow[]): boolean {
  return rows.some((row) => typeof row.billableUnits === "number" && Number.isFinite(row.billableUnits));
}

/** Split the order's billed page count across files that have no per-page units. */
function billedShares(
  order: CustomerOrder,
  byDocument: Map<string, QuotePageRow[]>,
): Map<string, number> {
  const targets: Array<{ id: string; weight: number }> = [];
  let known = 0;
  for (const document of order.documents) {
    const fileRows = byDocument.get(document.id) ?? [];
    if (rowsHaveBillableUnits(fileRows)) {
      known += sumQuotedBillable(fileRows);
      continue;
    }
    targets.push({
      id: document.id,
      weight: Math.max(document.pageCount ?? fileRows.length, 0),
    });
  }
  for (const [id, fileRows] of byDocument) {
    if (order.documents.some((document) => document.id === id)) continue;
    if (rowsHaveBillableUnits(fileRows)) {
      known += sumQuotedBillable(fileRows);
      continue;
    }
    targets.push({ id, weight: fileRows.length });
  }

  if (order.billablePages == null) {
    return new Map(targets.map((target) => [target.id, target.weight]));
  }
  return allocateShares(targets, Math.max(order.billablePages - known, 0));
}

function allocateShares(
  targets: Array<{ id: string; weight: number }>,
  total: number,
): Map<string, number> {
  const shares = new Map<string, number>();
  if (targets.length === 0) return shares;
  const weightSum = targets.reduce((sum, target) => sum + target.weight, 0);
  if (weightSum <= 0) {
    targets.forEach((target, index) => shares.set(target.id, index === 0 ? total : 0));
    return shares;
  }
  const raw = targets.map((target) => (total * target.weight) / weightSum);
  const floors = raw.map((value) => Math.floor(value));
  let left = total - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) {
    if (left <= 0) break;
    floors[item.index] += 1;
    left -= 1;
  }
  targets.forEach((target, index) => shares.set(target.id, floors[index] ?? 0));
  return shares;
}

/** One group per uploaded file, with that file's page rows underneath. */
export function quoteFileGroups(order: CustomerOrder): QuoteFileGroup[] {
  const rows = quotePageRows(order);
  const byDocument = new Map<string, QuotePageRow[]>();
  for (const row of rows) {
    const list = byDocument.get(row.documentId) ?? [];
    list.push(row);
    byDocument.set(row.documentId, list);
  }
  const shares = billedShares(order, byDocument);

  const seen = new Set<string>();
  const groups: QuoteFileGroup[] = [];
  for (const document of order.documents) {
    seen.add(document.id);
    const fileRows = byDocument.get(document.id) ?? [];
    const billable = rowsHaveBillableUnits(fileRows)
      ? sumQuotedBillable(fileRows)
      : (shares.get(document.id) ?? document.pageCount ?? 0);
    groups.push({
      id: document.id,
      filename: document.filename,
      pages: fileRows.length > 0 ? fileRows.length : document.pageCount,
      billable,
      rows: fileRows,
    });
  }

  for (const [id, fileRows] of byDocument) {
    if (seen.has(id) || fileRows.length === 0) continue;
    const billable = rowsHaveBillableUnits(fileRows)
      ? sumQuotedBillable(fileRows)
      : (shares.get(id) ?? fileRows.length);
    groups.push({
      id,
      filename: fileRows[0]?.filename || "File",
      pages: fileRows.length,
      billable,
      rows: fileRows,
    });
  }
  return groups;
}

function pagesMatch(
  page: CustomerOrder["pages"][number],
  row: { documentId: string; uploadPage: number; appliedPage: number },
): boolean {
  if (page.documentId !== row.documentId) return false;
  if (page.uploadPage != null && page.uploadPage === row.uploadPage) return true;
  return page.pageNumber === row.appliedPage;
}

/** Indexes to send as `skipPages`: every skipped line in the list the quote is counting. */
export function skippedPageIndexes(order: {
  pages: Array<{ skip?: boolean }>;
  pageOrder: { pages: Array<{ skip?: boolean }> } | null;
}): number[] {
  return quoteIndexSource(order).flatMap((line, index) => (line.skip === true ? [index] : []));
}

export { skipPageNote };

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
  order?: { delayed?: boolean; reviewReason?: string | null } | null,
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
  if (status === "preview_ready") return "processing";
  if (
    status === "needs_review" &&
    (order?.delayed || order?.reviewReason === TRANSLATION_TIMEOUT_REASON)
  ) {
    return "processing";
  }
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
