import { languageLabel, sourceLanguageChoices } from "@/lib/orders/languages";
import type { CustomerOrder, PreviewResponse } from "@/lib/orders/view";
import {
  formatMoney,
  type PreviewOrder,
} from "@/components/preview/preview-order";

export const LANGUAGE_PENDING = "We'll confirm the language";

const PREVIEW_INCLUDED = [
  "Clean PDF, no watermark",
  "Signed certificate of accuracy",
  "Meets USCIS certification rules",
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

export function customerEmail(order: { email: string | null | undefined }): string {
  return order.email?.trim() ?? "";
}

/** Filename without its extension. `acta-nacimiento.pdf` → `acta-nacimiento`. */
export function downloadBase(documentName: string | null | undefined): string {
  const name = documentName?.trim() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

/** Certified translation download: `<base>-EN-certified.pdf`. */
export function certifiedDownloadName(documentName: string | null | undefined): string {
  const base = downloadBase(documentName);
  return base ? `${base}-EN-certified.pdf` : "document-EN-certified.pdf";
}

/** Original download keeps the uploaded name. */
export function originalDownloadName(documentName: string | null | undefined): string {
  return documentName?.trim() ?? "";
}

/** Checkout shows the order address, then the signed-in account, then nothing. */
export function checkoutEmail(
  orderEmail: string | null | undefined,
  accountEmail: string | null | undefined,
): string {
  return customerEmail({ email: orderEmail }) || accountEmail?.trim() || "";
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

const RETAKE_FLAG_ORDER = ["blurry", "cropped", "glare", "too_dark", "unreadable_fields"] as const;

export type RetakeFlag = (typeof RETAKE_FLAG_ORDER)[number];

export const RETAKE_FLAG_LABEL: Record<RetakeFlag, string> = {
  blurry: "Blurry",
  cropped: "Cropped",
  glare: "Glare",
  too_dark: "Too dark",
  unreadable_fields: "Unreadable fields",
};

export type RetakePage = {
  key: string;
  documentId: string;
  filename: string;
  detail: string;
  flags: RetakeFlag[];
  message: string | null;
};

const RETAKE_FALLBACK =
  "This photo is hard to read. Retake it in even light, with the whole page in the frame and the text sharp, then upload a replacement.";

function retakeFlags(flags: readonly string[]): RetakeFlag[] {
  const present = new Set(flags);
  return RETAKE_FLAG_ORDER.filter((flag) => present.has(flag));
}

function qualityPage(
  pages: CustomerOrder["pages"],
  documentId: string,
  appliedPage: number,
  uploadPage: number,
) {
  return (
    pages.find((page) => page.documentId === documentId && page.pageNumber === appliedPage) ??
    pages.find(
      (page) =>
        page.documentId === documentId && page.uploadPage != null && page.uploadPage === uploadPage,
    )
  );
}

/** Pages to show on an image-quality retake, in `pageOrder` when analysis stored one. */
export function retakePages(order: CustomerOrder): RetakePage[] {
  const filenames = new Map(order.documents.map((document) => [document.id, document.filename]));
  if (order.pageOrder && order.pageOrder.pages.length > 0) {
    return order.pageOrder.pages.map((page) => {
      const quality = qualityPage(order.pages, page.documentId, page.appliedPage, page.uploadPage);
      const moved =
        page.uploadPosition !== page.appliedPosition || page.uploadPage !== page.appliedPage;
      return {
        key: `${page.documentId}-${page.uploadPage}-${page.appliedPage}`,
        documentId: page.documentId,
        filename: page.filename || filenames.get(page.documentId) || "Page",
        detail: [
          page.logicalPage != null ? `printed page ${page.logicalPage}` : "",
          page.hint ?? "",
          moved ? "moved from the upload order" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        flags: retakeFlags(quality?.qualityFlags ?? []),
        message: quality?.qualityMessage ?? null,
      };
    });
  }

  if (order.pages.length > 0) {
    return order.pages.map((page) => ({
      key: `${page.documentId}-${page.pageNumber}`,
      documentId: page.documentId,
      filename: filenames.get(page.documentId) || "Page",
      detail: [
        page.logicalPage != null ? `printed page ${page.logicalPage}` : `page ${page.pageNumber}`,
        page.orderHint ?? "",
      ]
        .filter(Boolean)
        .join(" · "),
      flags: retakeFlags(page.qualityFlags),
      message: page.qualityMessage,
    }));
  }

  return order.documents.map((document) => ({
    key: document.id,
    documentId: document.id,
    filename: document.filename,
    detail: "",
    flags: [],
    message: null,
  }));
}

export function retakeInstructions(pages: readonly RetakePage[]): string[] {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const page of pages) {
    const message = page.message?.trim();
    if (!message || seen.has(message)) continue;
    seen.add(message);
    messages.push(message);
  }
  return messages.length > 0 ? messages : [RETAKE_FALLBACK];
}

/** Documents the clearer-photo button should replace, in thumbnail order. */
export function retakeDocumentIds(pages: readonly RetakePage[]): string[] {
  const ids: string[] = [];
  for (const page of pages) {
    if (page.flags.length === 0 && !page.message) continue;
    if (!ids.includes(page.documentId)) ids.push(page.documentId);
  }
  if (ids.length === 0 && pages[0]) ids.push(pages[0].documentId);
  return ids;
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
      documentIndex: page.documentIndex,
      documentName: page.documentName,
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
    pricing: {
      perPageCents: preview.unitPriceCents,
      pages,
      certificationIncluded: true,
      totalCents: preview.totalCents ?? 0,
    },
    included: PREVIEW_INCLUDED,
    corrections: preview.corrections
      .filter((correction) => correction.page != null)
      .map((correction) => {
        const page = preview.original.pages.find(
          (item) => item.number === correction.page,
        );
        return {
          id: correction.id,
          page: correction.page ?? 1,
          documentId: correction.documentId ?? page?.documentId ?? null,
          documentName: page?.documentName,
          passage: correction.quote,
          note: correction.note ?? "",
          status: "sent" as const,
          label: correction.note?.trim() || "Correction",
          detail: correction.status,
        };
      }),
  };
}
