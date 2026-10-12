import { PDFDocument } from "pdf-lib";
import { ORDER_CONFIDENCE } from "./constants";
import type { StoredPage, StoredPageOrder } from "./types";

export type PageCue = {
  documentId: string;
  uploadPosition: number;
  uploadPage: number;
  logicalPage: number | null;
  hint: string | null;
  confidence: number | null;
};

const CONTINUATION =
  /\b(continu\w*|suite|siguiente|suivante|seq\.?|cont\.?|follows|see next|à suivre|a suivre)\b/i;

export function parseOrderHint(hint: string | null): { page: number; total: number | null } | null {
  if (!hint) return null;
  const fraction = hint.match(/(\d+)\s*(?:\/|of|sur)\s*(\d+)/i);
  if (fraction) {
    const page = Number(fraction[1]);
    const total = Number(fraction[2]);
    if (page >= 1 && total >= 1) return { page, total };
  }
  const labeled = hint.match(/\b(?:page|p[áa]g(?:ina)?|p\.?)\s*(\d+)\b/i);
  if (labeled) {
    const page = Number(labeled[1]);
    if (page >= 1) return { page, total: null };
  }
  return null;
}

export function positivePage(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1 ? rounded : null;
}

function statedLogical(cue: PageCue): number | null {
  return positivePage(cue.logicalPage) ?? parseOrderHint(cue.hint)?.page ?? null;
}

function cueConfidence(cue: PageCue): number {
  const model = positivePage(cue.logicalPage);
  const parsed = parseOrderHint(cue.hint);
  if (model != null && parsed && parsed.page !== model) return 0;
  if (cue.confidence == null || !Number.isFinite(cue.confidence)) return 0;
  return cue.confidence;
}

function isContinuationOnly(cue: PageCue): boolean {
  if (!cue.hint || statedLogical(cue) != null) return false;
  return CONTINUATION.test(cue.hint);
}

function byUpload(a: PageCue, b: PageCue): number {
  return a.uploadPosition - b.uploadPosition || a.uploadPage - b.uploadPage;
}

function resolveGroup(group: PageCue[]): { basis: "logical" | "upload"; ordered: PageCue[] } {
  const upload = [...group].sort(byUpload);
  if (upload.length < 2) return { basis: "upload", ordered: upload };

  const annotated = upload.map((cue) => ({
    cue,
    logical: statedLogical(cue),
    confidence: cueConfidence(cue),
    continuation: isContinuationOnly(cue),
  }));
  if (annotated.some((item) => item.confidence < ORDER_CONFIDENCE)) {
    return { basis: "upload", ordered: upload };
  }

  const totals = annotated
    .map((item) => parseOrderHint(item.cue.hint)?.total)
    .filter((total): total is number => total != null);
  if (totals.some((total) => total !== upload.length)) {
    return { basis: "upload", ordered: upload };
  }

  const numbered = annotated.filter((item) => item.logical != null);
  const missing = annotated.filter((item) => item.logical == null);
  const numbers = numbered.map((item) => item.logical as number);
  const distinct = new Set(numbers).size === numbers.length;

  if (missing.length === 0 && distinct) {
    const isOneToN = numbers.every((page) => page >= 1 && page <= upload.length);
    const hintsAgree = annotated.every((item) => {
      const parsed = parseOrderHint(item.cue.hint);
      return parsed != null && parsed.page === item.logical;
    });
    if (isOneToN || hintsAgree) {
      const ordered = [...annotated].sort(
        (a, b) =>
          (a.logical as number) - (b.logical as number) ||
          a.cue.uploadPosition - b.cue.uploadPosition ||
          a.cue.uploadPage - b.cue.uploadPage,
      );
      return { basis: "logical", ordered: ordered.map((item) => item.cue) };
    }
  }

  if (missing.length === 1 && missing[0]?.continuation) {
    const expected = new Set(Array.from({ length: upload.length - 1 }, (_, index) => index + 1));
    const continuationFits =
      numbers.length === expected.size &&
      distinct &&
      numbers.every((page) => expected.has(page));
    if (continuationFits) {
      const head = [...numbered].sort((a, b) => (a.logical as number) - (b.logical as number));
      return { basis: "logical", ordered: [...head.map((item) => item.cue), missing[0].cue] };
    }
  }

  return { basis: "upload", ordered: upload };
}

function toStored(cue: PageCue, appliedPosition: number, appliedPage: number): StoredPage {
  return {
    documentId: cue.documentId,
    uploadPosition: cue.uploadPosition,
    appliedPosition,
    uploadPage: cue.uploadPage,
    appliedPage,
    logicalPage: statedLogical(cue),
    hint: cue.hint?.trim() ? cue.hint.trim() : null,
    confidence: cue.confidence,
  };
}

/**
 * Reorder pages inside one uploaded file when every page has a confident sequence.
 * Single-page files that were uploaded as one document are reordered together.
 * Anything short of a confident sequence stays in upload order.
 */
export function applyPageOrder(cues: PageCue[]): StoredPageOrder {
  if (cues.length === 0) return { basis: "upload", pages: [] };

  const groups = new Map<string, PageCue[]>();
  for (const cue of [...cues].sort(byUpload)) {
    const group = groups.get(cue.documentId);
    if (group) group.push(cue);
    else groups.set(cue.documentId, [cue]);
  }
  const grouped = [...groups.values()];
  const multiPage = grouped.some((group) => group.length > 1);

  if (multiPage) {
    const pages: StoredPage[] = [];
    let logical = false;
    for (const group of grouped) {
      const resolved = resolveGroup(group);
      if (resolved.basis === "logical") logical = true;
      const uploadPosition = resolved.ordered[0]?.uploadPosition ?? group[0]?.uploadPosition ?? 1;
      resolved.ordered.forEach((cue, index) => {
        pages.push(toStored(cue, uploadPosition, index + 1));
      });
    }
    return { basis: logical ? "logical" : "upload", pages };
  }

  const resolved = resolveGroup(cues);
  return {
    basis: resolved.basis,
    pages: resolved.ordered.map((cue, index) => toStored(cue, index + 1, 1)),
  };
}

export function readingPosition(document: { position: number; appliedPosition: number | null }): number {
  return document.appliedPosition ?? document.position;
}

export function inReadingOrder<T extends { position: number; appliedPosition: number | null }>(
  documents: T[],
): T[] {
  return [...documents].sort(
    (a, b) => readingPosition(a) - readingPosition(b) || a.position - b.position,
  );
}

export function compareCombinedPages(
  documents: Array<{ id: string; position: number; appliedPosition: number | null }>,
  a: { documentId: string; pageNumber: number },
  b: { documentId: string; pageNumber: number },
): number {
  const position = new Map(documents.map((document) => [document.id, readingPosition(document)]));
  const docDelta = (position.get(a.documentId) ?? 0) - (position.get(b.documentId) ?? 0);
  if (docDelta !== 0) return docDelta;
  return a.pageNumber - b.pageNumber;
}

export function filesInAppliedOrder<T extends { documentId: string }>(
  files: T[],
  applied: StoredPageOrder,
): T[] {
  const position = new Map<string, number>();
  for (const page of applied.pages) {
    const current = position.get(page.documentId);
    if (current == null || page.appliedPosition < current) position.set(page.documentId, page.appliedPosition);
  }
  return [...files].sort(
    (a, b) => (position.get(a.documentId) ?? 0) - (position.get(b.documentId) ?? 0),
  );
}

/** Old combined-PDF indexes in the applied reading order. Files must already be in applied file order. */
export function pdfPagePermutation(
  orderedFiles: Array<{ documentId: string; pageCount: number }>,
  applied: StoredPageOrder,
): number[] {
  const desired: number[] = [];
  let start = 0;
  for (const file of orderedFiles) {
    const pages = applied.pages
      .filter((page) => page.documentId === file.documentId)
      .sort((a, b) => a.appliedPage - b.appliedPage);
    if (pages.length !== file.pageCount) {
      for (let index = 0; index < file.pageCount; index += 1) desired.push(start + index);
    } else {
      for (const page of pages) desired.push(start + page.uploadPage - 1);
    }
    start += file.pageCount;
  }
  return desired;
}

export function isIdentityOrder(order: number[]): boolean {
  return order.every((value, index) => value === index);
}

export async function permutePdfPages(pdf: Uint8Array, order: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdf);
  if (order.length !== src.getPageCount() || order.some((index) => index < 0 || index >= order.length)) {
    throw new Error("Page order does not match the combined PDF");
  }
  const dest = await PDFDocument.create();
  const copied = await dest.copyPages(src, order);
  for (const page of copied) dest.addPage(page);
  return dest.save();
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseStoredPageOrder(value: unknown): StoredPageOrder | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { basis?: unknown; pages?: unknown };
  if (record.basis !== "logical" && record.basis !== "upload") return null;
  if (!Array.isArray(record.pages)) return null;
  const pages: StoredPage[] = [];
  for (const entry of record.pages) {
    if (!entry || typeof entry !== "object") return null;
    const page = entry as Record<string, unknown>;
    if (typeof page.documentId !== "string" || page.documentId.length === 0) return null;
    const uploadPosition = finite(page.uploadPosition);
    const appliedPosition = finite(page.appliedPosition);
    const uploadPage = finite(page.uploadPage);
    const appliedPage = finite(page.appliedPage);
    if (
      uploadPosition == null ||
      appliedPosition == null ||
      uploadPage == null ||
      appliedPage == null
    ) {
      return null;
    }
    pages.push({
      documentId: page.documentId,
      uploadPosition,
      appliedPosition,
      uploadPage,
      appliedPage,
      logicalPage: finite(page.logicalPage),
      hint: typeof page.hint === "string" && page.hint.trim() ? page.hint : null,
      confidence: finite(page.confidence),
    });
  }
  return { basis: record.basis, pages };
}
