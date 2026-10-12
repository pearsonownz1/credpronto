import { UNIT_PRICE_CENTS, UNITS_PER_BILLABLE_PAGE } from "@/lib/orders/constants";
import type { FlowDraft, FlowFile, FlowQuote, PricedFile } from "./types";

export const PRICE_PER_PAGE_CENTS = UNIT_PRICE_CENTS;

export function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function pageLabel(pages: number) {
  return `${pages} ${pages === 1 ? "page" : "pages"}`;
}

/**
 * A physical side is one billable page until the estimated unit count exceeds 1,000.
 * Extra sides still count.
 */
export function billablePages(words: number, sides: number) {
  const safeWords = Number.isFinite(words) ? Math.max(0, words) : 0;
  const safeSides = Number.isFinite(sides) ? Math.max(0, sides) : 0;
  const sidePages = Math.max(1, safeSides);
  const wordPages = Math.max(1, Math.ceil(safeWords / UNITS_PER_BILLABLE_PAGE));
  return Math.max(sidePages, wordPages);
}

export function priceFile(file: FlowFile): PricedFile {
  const pages = billablePages(file.words, file.sides);
  return {
    ...file,
    pages,
    amountCents: pages * PRICE_PER_PAGE_CENTS,
  };
}

export function priceDraft(draft: Pick<FlowDraft, "files">): FlowQuote {
  const files = draft.files.map(priceFile);
  const pages = files.reduce((sum, file) => sum + file.pages, 0);
  const wordCount = files.reduce((sum, file) => sum + file.words, 0);
  const subtotalCents = pages * PRICE_PER_PAGE_CENTS;
  return {
    files,
    pages,
    wordCount,
    perPageCents: PRICE_PER_PAGE_CENTS,
    subtotalCents,
    previewCents: 0,
    totalCents: subtotalCents,
    certificationIncluded: true,
  };
}
