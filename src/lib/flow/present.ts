import { serviceCents, withoutExpedited } from "@/lib/orders/addons";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { evaluationServiceDescription, isTranslationBundle } from "@/lib/orders/evaluation-price";
import { priceServices } from "@/lib/orders/service-selection";
import { serviceRequestFromOrder } from "@/lib/flow/order-choice";

export { isTranslationBundle };
import { TRANSLATION_TIMEOUT_REASON } from "@/lib/orders/translation-failure";
import {
  languageLabel,
  languagesEqual,
  sourceLanguageChoices,
  targetLanguageChoices,
} from "@/lib/orders/languages";
import { skipPageNote, sumQuotedBillable } from "@/lib/orders/skip-pages";
import { translationSpeedLine } from "@/lib/orders/speed-line";
import { previewIsReady, type PreviewReadyOrder } from "@/lib/flow/preview-progress";
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
/** Header label for every uploaded file, not just the first. */
export function documentsLabel(documents: ReadonlyArray<{ filename: string }>): string {
  const names = documents.map((document) => document.filename.trim()).filter(Boolean);
  if (names.length === 0) return "document.pdf";
  if (names.length <= 2) return names.join(" + ");
  return `${names[0]} + ${names.length - 1} more`;
}

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
      label: billablePriceLabel(pages, order.unitPriceCents),
      amountCents: pages * order.unitPriceCents,
    },
  ];
}

function priceLineLabel(item: EvaluationLine): string {
  if (item.kind === "evaluation") return item.description;
  const pages = fileCountLabel(item.quantity);
  return `${item.description}, ${pages}`;
}

/** Local stand-in while a translation checkbox is in flight. The settled total is the server quote. */
export function orderWithTranslationChoice(order: CustomerOrder, includeTranslation: boolean): CustomerOrder {
  const request = serviceRequestFromOrder(order, { includeTranslation });
  if (request.orderType !== "evaluation" || order.degreeCount == null) return order;
  const priced = priceServices({
    services: request.services,
    degreeCount: order.degreeCount,
    sourceLanguage: order.sourceLanguage,
    billablePages: order.billablePages ?? 0,
    chargeUnknownLanguage: true,
  });
  if (!priced) return order;
  return {
    ...order,
    services: priced.services,
    service: priced.service,
    includeTranslation: priced.includeTranslation,
    evaluationCents: priced.evaluationCents,
    translationCents: priced.translationCents,
    totalCents: priced.totalCents,
    unitPriceCents: priced.unitPriceCents,
    lineItems: priced.lineItems,
  };
}

const EVALUATION_CONFIRM_LABELS: Record<string, string> = {
  holder_name: "Credential holder",
  school: "School",
  degree: "Degree",
  dates_attended: "Dates attended",
  date_awarded: "Date awarded",
};

/** Preview rail rows for an evaluation. Prefers the report, then confirmed fields. */
export function evaluationPreviewDetails(order: {
  evaluation: CustomerOrder["evaluation"];
  confirmations: CustomerOrder["confirmations"];
}): Array<{ label: string; value: string }> {
  const result = order.evaluation;
  if (result?.kind === "diploma") {
    return result.credentials.flatMap((credential, index) => {
      const prefix = result.credentials.length > 1 ? `Degree ${index + 1} · ` : "";
      return detailRows([
        [`${prefix}Credential holder`, credential.applicant],
        [`${prefix}School`, credential.institution],
        [`${prefix}Degree`, credential.credential],
        [`${prefix}Dates`, credential.dates],
        [`${prefix}U.S. equivalency`, credential.usEquivalency],
      ]);
    });
  }
  if (result?.kind === "course_by_course") {
    return detailRows([
      ["Credential holder", result.applicant],
      ["School", result.institution],
      ["Degree", result.credential],
      ["U.S. equivalency", result.usEquivalency ?? ""],
    ]);
  }
  return detailRows(
    Object.entries(EVALUATION_CONFIRM_LABELS).map(([key, label]) => [
      label,
      order.confirmations.find((field) => field.fieldKey === key)?.confirmedValue ?? "",
    ]),
  );
}

function detailRows(rows: Array<[string, string]>): Array<{ label: string; value: string }> {
  return rows
    .map(([label, value]) => ({ label, value: value.trim() }))
    .filter((row) => row.value.length > 0);
}

export type DownloadFileKind = "translation" | "certification" | "evaluation";

export type DownloadReadyCopy = {
  title: string;
  primaryTitle: string;
  primaryFile: DownloadFileKind;
  secondary: { title: string; file: "certification" } | null;
  again: string;
};

export type OrderContents = {
  translation: boolean;
  evaluation: boolean;
};

/**
 * What the customer bought.
 * A `services` list wins (`translation`, `diploma`, `course_by_course`).
 * Older orders fall back to `service`, then the order type.
 */
export function orderContents(order: {
  services?: readonly string[] | null;
  service?: string | null;
  orderType?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
}): OrderContents {
  const listed = (order.services ?? []).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  if (listed.length > 0) {
    return {
      translation: listed.includes("translation"),
      evaluation: listed.some((item) => item === "diploma" || item === "course_by_course"),
    };
  }
  const evaluation =
    order.orderType === "evaluation" ||
    order.serviceType === "evaluation" ||
    order.service === "diploma" ||
    order.service === "course_by_course" ||
    (order.service != null && order.service !== "translation");
  if (evaluation) return { translation: order.includeTranslation === true, evaluation: true };
  return { translation: true, evaluation: false };
}

export const TRANSLATION_TURNAROUND_COPY = "Translation ready in about 1 minute.";
export const EVALUATION_TURNAROUND_COPY = "Evaluation ready in about 5 minutes.";

/** Shown on the quote, before payment. Any evaluation sets the longer time, with or without a translation. */
export function quoteTurnaroundCopy(order: {
  services?: readonly string[] | null;
  service?: string | null;
  orderType?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
}): string {
  return orderContents(order).evaluation ? EVALUATION_TURNAROUND_COPY : TRANSLATION_TURNAROUND_COPY;
}

/** Payment has been recorded. The checkout stepper is no longer the status. */
export function orderIsPaid(order: {
  status?: string | null;
  payment?: { status: string } | null;
  fulfillment?: "released" | "awaiting_review" | null;
}): boolean {
  if (order.fulfillment === "released" || order.fulfillment === "awaiting_review") return true;
  if (order.status === "paid" || order.status === "approved" || order.status === "delivered") return true;
  const payment = order.payment?.status;
  return payment === "paid" || payment === "paid_test";
}

/** The whole order is approved, or the certified file has been released. */
export function orderApprovedOrDelivered(order: {
  status?: string | null;
  delivery?: { status: string } | null;
  fulfillment?: "released" | "awaiting_review" | null;
}): boolean {
  if (order.fulfillment === "awaiting_review") return false;
  if (order.fulfillment === "released") return true;
  const delivery = order.delivery?.status;
  if (delivery === "approved" || delivery === "delivered") return true;
  return order.status === "approved" || order.status === "delivered";
}

/**
 * True until the whole order is approved or delivered.
 * A finished translation does not count: Download waits for this signal.
 */
export function orderPackagePending(order: {
  status?: string | null;
  delivery?: { status: string } | null;
  fulfillment?: "released" | "awaiting_review" | null;
}): boolean {
  return !orderApprovedOrDelivered(order);
}

/** The delivery email has gone out. Approved is not the same as delivered. */
export function orderWasDelivered(order: {
  status?: string | null;
  delivery?: { status: string } | null;
  deliveredAt?: string | null;
}): boolean {
  if (typeof order.deliveredAt === "string" && order.deliveredAt.trim() !== "") return true;
  if (order.status === "delivered") return true;
  return order.delivery?.status === "delivered";
}

/** Labels and file kinds for one package download. A combo is a single file, not one button per item. */
export function downloadReadyCopy(order: {
  orderType?: string | null;
  service?: string | null;
  serviceType?: string | null;
  services?: readonly string[] | null;
  includeTranslation?: boolean | null;
}): DownloadReadyCopy {
  const contents = orderContents(order);
  if (contents.evaluation && contents.translation) {
    return {
      title: "Your order is ready.",
      primaryTitle: "Your files",
      primaryFile: "evaluation",
      secondary: null,
      again: "Start another order",
    };
  }
  if (contents.evaluation) {
    return {
      title: "Your credential evaluation is ready.",
      primaryTitle: "Evaluation report",
      primaryFile: "evaluation",
      secondary: null,
      again: "Need another credential evaluated?",
    };
  }
  return {
    title: "Your certified translation is ready.",
    primaryTitle: "Certified translation",
    primaryFile: "translation",
    secondary: null,
    again: "Need another document translated?",
  };
}

export type DownloadPhase = "finalizing" | "certifying" | "ready";

/** Checkout return, before the payment webhook has recorded the order. */
export const CONFIRMING_PAYMENT_COPY = "Confirming payment";

export const CONFIRMING_PAYMENT_DETAIL =
  "Stripe sent you back before the payment showed on this order. This page keeps checking.";

/** Heading while a paid translation is still awaiting release of the certified PDF. */
export const QUICK_CHECK_COPY = "Paid. We're finishing your certified PDF.";

/** Heading while a paid evaluation report is still being finished. */
export const EVALUATION_REVIEW_COPY = "Paid. We're finishing your credential evaluation report.";

/** Heading while a paid translation and evaluation are still being finished together. */
export const COMBO_REVIEW_COPY = "Paid. We're finishing your certified translation and credential evaluation.";

/** Post-payment heading. Translation-only keeps the certified PDF line. */
export function paidReviewHeading(order: {
  services?: readonly string[] | null;
  service?: string | null;
  orderType?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
}): string {
  const contents = orderContents(order);
  if (contents.evaluation && contents.translation) return COMBO_REVIEW_COPY;
  if (contents.evaluation) return EVALUATION_REVIEW_COPY;
  return QUICK_CHECK_COPY;
}

/**
 * Nothing for the customer to do on this hold.
 * No customer-facing turnaround is stated for the post-payment review, so this line does not name one.
 */
export const QUICK_CHECK_DETAIL = "Nothing to do. We'll email you when it's ready.";

export const CLOSE_PAGE_NOTE = "You can close this page.";

/** Customer's orders dashboard. */
export const ORDERS_DASHBOARD_HREF = "/dashboard";

/** One next step while the package is in review. */
export function paidReviewEmailLine(): string {
  return QUICK_CHECK_DETAIL;
}

export type PackageProgressState = "done" | "current" | "upcoming";

export type PackageProgressId = "quick_review" | "almost_ready" | "ready";

export type PackageProgressStep = {
  id: PackageProgressId;
  label: string;
  state: PackageProgressState;
};

/** Same three steps for every paid package. No per-product step names. */
export const PACKAGE_PROGRESS_LABEL: Record<PackageProgressId, string> = {
  quick_review: "Quick Review",
  almost_ready: "Almost Ready",
  ready: "Ready",
};

const PACKAGE_PROGRESS_ORDER: PackageProgressId[] = ["quick_review", "almost_ready", "ready"];

/**
 * Work is far enough that only final approval is left.
 * A finished translation, an attached report, or a completed evaluation still waits on the whole order.
 */
export function packageNearlyDone(order: {
  services?: readonly string[] | null;
  service?: string | null;
  orderType?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
  translationReady?: boolean | null;
  evaluationStatus?: string | null;
  evaluation?: unknown;
}): boolean {
  if (order.translationReady === true) return true;
  if (order.evaluation != null) return true;
  return order.evaluationStatus === "evaluation_complete";
}

/** Quick Review while paid work is underway, Almost Ready when only approval is left, Ready when the package is approved. */
export function packageProgress(order: {
  status: string;
  payment?: { status: string } | null;
  delivery?: { status: string } | null;
  fulfillment?: "released" | "awaiting_review" | null;
  services?: readonly string[] | null;
  service?: string | null;
  orderType?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
  translationReady?: boolean | null;
  evaluationStatus?: string | null;
  evaluation?: unknown;
}): PackageProgressId {
  if (downloadPhase(order) === "ready") return "ready";
  if (packageNearlyDone(order)) return "almost_ready";
  return "quick_review";
}

export function packageProgressSteps(current: PackageProgressId): PackageProgressStep[] {
  const currentIndex = PACKAGE_PROGRESS_ORDER.indexOf(current);
  return PACKAGE_PROGRESS_ORDER.map((id, index) => ({
    id,
    label: PACKAGE_PROGRESS_LABEL[id],
    state: index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming",
  }));
}

/** Receipt from fields already on the order. Omits an amount or date the order does not have. */
export function paidReceiptLine(order: { totalCents: number | null; paidAt: string | null }): string {
  const amount = order.totalCents == null ? null : totalLabel(order.totalCents);
  const date = paidDateLabel(order.paidAt);
  if (amount && date) return `Paid ${amount} on ${date}`;
  if (amount) return `Paid ${amount}`;
  if (date) return `Paid on ${date}`;
  return "Paid";
}

function paidDateLabel(iso: string | null | undefined): string | null {
  const trimmed = iso?.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Shown with the download only after the package email has been sent. */
export const ORDER_DELIVERED_NOTE = "We also emailed you a copy.";

export function downloadEmailedLine(
  order?: {
    status?: string | null;
    delivery?: { status: string } | null;
    deliveredAt?: string | null;
  } | null,
): string | null {
  if (!order || !orderWasDelivered(order)) return null;
  return ORDER_DELIVERED_NOTE;
}

/** How often the paid page asks for order status until the PDF is released. */
export const ORDER_STATUS_POLL_MS = 5_000;

/** Faster checks while the webhook and release are still landing. */
export const FINALIZING_POLL_MS = 1_000;

export function orderStatusPollDelay(phase: DownloadPhase): number | null {
  if (phase === "ready") return null;
  if (phase === "finalizing") return FINALIZING_POLL_MS;
  return ORDER_STATUS_POLL_MS;
}

export function downloadPhase(order: {
  status: string;
  payment?: { status: string } | null;
  delivery?: { status: string } | null;
  fulfillment?: "released" | "awaiting_review" | null;
  services?: readonly string[] | null;
  service?: string | null;
  orderType?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
  translationReady?: boolean | null;
  evaluationStatus?: string | null;
}): DownloadPhase {
  const paid =
    order.status === "paid" ||
    order.status === "approved" ||
    order.status === "delivered" ||
    order.payment?.status === "paid" ||
    order.payment?.status === "paid_test";
  if (order.fulfillment !== "released" && order.fulfillment !== "awaiting_review" && !paid) {
    return "finalizing";
  }
  // One package. A released translation does not open Download while an evaluation is still pending.
  if (order.fulfillment === "awaiting_review" || orderPackagePending(order)) return "certifying";
  if (order.fulfillment === "released") return "ready";
  if (!paid) return "finalizing";
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

export type OrderHubStep = "download" | "preview" | "quote" | "processing" | "cancel" | "checkout";

export function isCustomerEvaluation(order: {
  orderType?: string | null;
  service?: string | null;
  serviceType?: string | null;
}): boolean {
  return order.orderType === "evaluation" || order.serviceType === "evaluation" || order.service != null;
}

/** Which screen `/order/[token]` shows for a checkout return or order status. */
function payFirstEvaluation(order: {
  orderType?: string | null;
  service?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
} | null | undefined): boolean {
  return order != null && isCustomerEvaluation(order) && !isTranslationBundle(order);
}

export function orderHubStep(
  checkout: string | null | undefined,
  status: string | null | undefined,
  order?: {
    delayed?: boolean;
    reviewReason?: string | null;
    fulfillment?: "released" | "awaiting_review" | null;
    orderType?: string | null;
    service?: string | null;
    serviceType?: string | null;
    includeTranslation?: boolean | null;
  } | null,
): OrderHubStep {
  if (checkout === "success") return "download";
  if (checkout === "cancel") {
    if (payFirstEvaluation(order) && status !== "preview_ready") return "processing";
    return "cancel";
  }
  if (order?.fulfillment === "released" || order?.fulfillment === "awaiting_review") {
    return "download";
  }
  if (
    status === "paid" ||
    status === "approved" ||
    status === "delivered"
  ) {
    return "download";
  }
  // Standalone evaluations stay here while the draft is built, then the preview route opens Review.
  if (payFirstEvaluation(order)) return "processing";
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

/**
 * Preview page for an order whose watermarked preview already exists.
 * Null while `/order/[token]` should keep its quote, payment, or progress screen.
 */
export function readyPreviewPath(
  token: string,
  checkout: string | null | undefined,
  order: PreviewReadyOrder & {
    delayed?: boolean;
    reviewReason?: string | null;
    fulfillment?: "released" | "awaiting_review" | null;
    orderType?: string | null;
    service?: string | null;
    serviceType?: string | null;
    includeTranslation?: boolean | null;
  },
): string | null {
  if (!token) return null;
  if (orderHubStep(checkout, order.status, order) !== "processing") return null;
  if (!previewIsReady(order)) return null;
  return `/preview/${encodeURIComponent(token)}`;
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

/** Enough to open the PDFs before GET /api/orders/:id (which includes every page's OCR text) returns. */
export function previewShellOrder(id: string, preview: PreviewResponse): PreviewOrder {
  const pages = preview.billablePages ?? preview.original.pageCount;
  const mapPages = (input: PreviewResponse["original"]["pages"]) =>
    input.map((page) => ({
      page: page.number,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      documentId: page.documentId,
    }));
  const filename = preview.original.pages[0]?.documentName || "document.pdf";

  return {
    id,
    status: "preview_ready",
    sourceLanguage: LANGUAGE_PENDING,
    targetLanguage: "English",
    filename,
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
    pricing: {
      perPageCents: preview.unitPriceCents,
      pages,
      certificationIncluded: true,
      totalCents: preview.totalCents ?? 0,
    },
    included: PREVIEW_INCLUDED,
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

  const bundle = isTranslationBundle(order);
  const evaluation = !bundle && (order.orderType === "evaluation" || order.service != null);
  const pageCount = order.billablePages ?? pages;
  const translationCents = order.translationCents ?? 0;
  const pageLines =
    bundle && translationCents > 0
      ? [{ label: billablePriceLabel(pageCount, UNIT_PRICE_CENTS), amountCents: translationCents }]
      : bundle
        ? []
        : servicePriceLines(order);
  const evaluationLine =
    bundle && order.evaluationCents != null && order.evaluationCents > 0 && order.service
      ? {
          label: evaluationServiceDescription(order.service),
          amountCents: order.evaluationCents,
        }
      : undefined;

  return {
    id: order.orderId,
    status: "preview_ready",
    sourceLanguage: order.sourceLanguage
      ? languageLabel(order.sourceLanguage)
      : LANGUAGE_PENDING,
    targetLanguage: order.targetLanguage
      ? languageLabel(order.targetLanguage)
      : "English",
    filename: documentsLabel(order.documents),
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
    product: evaluation ? "evaluation" : "translation",
    evaluationDetails: evaluation ? evaluationPreviewDetails(order) : undefined,
    evaluationLine,
    pricing: {
      perPageCents: bundle ? UNIT_PRICE_CENTS : preview.unitPriceCents,
      pages,
      certificationIncluded: true,
      totalCents:
        serviceCents({
          billablePages: preview.billablePages,
          unitPriceCents: bundle ? UNIT_PRICE_CENTS : preview.unitPriceCents,
          service: order.service,
          evaluationCents: order.evaluationCents,
          translationCents: order.translationCents,
        }) ??
        preview.totalCents ??
        0,
      lines: pageLines,
    },
    addonOptions: withoutExpedited(order.addonOptions, true),
    addons: order.addons,
    shippingAddress: order.shippingAddress,
    included: evaluation ? EVALUATION_INCLUDED : PREVIEW_INCLUDED,
    speedLine: evaluation ? null : translationSpeedLine(order.uploadedAt, order.translationReadyAt),
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
