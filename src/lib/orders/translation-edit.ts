import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "./constants";

export type PageTranslation = {
  documentId: string;
  pageNumber: number;
  combinedPageNumber: number;
  widthPt: number | null;
  heightPt: number | null;
  paragraphs: string[];
};

export type PageEdit = {
  documentId: string;
  pageNumber: number;
  paragraphs: string[];
};

export type MergedRenderPage = {
  combinedPageNumber: number;
  widthPt: number;
  heightPt: number;
  paragraphs: string[];
};

export const EMPTY_TRANSLATION_MESSAGE =
  "The translation text is empty. Add the translation before approving and releasing the files.";

/** Refuse release when no page has translation text. */
export function emptyTranslationMessage(pages: Array<{ paragraphs: string[] }>): string | null {
  const hasText = pages.some((page) => page.paragraphs.some((paragraph) => paragraph.trim().length > 0));
  return hasText ? null : EMPTY_TRANSLATION_MESSAGE;
}

export type MergeResult =
  | { ok: true; pages: MergedRenderPage[]; edited: number }
  | { ok: false; error: string };

export function paragraphsForPage(
  output: unknown,
  page: { pageNumber: number; combinedPageNumber?: number },
): string[] | null {
  if (!output || typeof output !== "object") return null;
  const pages = (output as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return null;

  const records = pages.filter((entry): entry is { pageNumber?: unknown; combinedPageNumber?: unknown; paragraphs?: unknown } =>
    Boolean(entry) && typeof entry === "object",
  );
  const match =
    records.find((record) => record.pageNumber === page.pageNumber) ??
    records.find(
      (record) => page.combinedPageNumber != null && record.combinedPageNumber === page.combinedPageNumber,
    );
  if (!match || typeof match !== "object") return null;
  const paragraphs = (match as { paragraphs?: unknown }).paragraphs;
  if (!Array.isArray(paragraphs)) return null;
  const text = paragraphs.filter((item): item is string => typeof item === "string");
  return text.length > 0 ? text : null;
}

function cleanParagraphs(paragraphs: string[]): string[] | null {
  const cleaned = paragraphs.map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

/** Apply staff edits onto the current translation and produce one render page per original side. */
export function mergeEditedPages(current: PageTranslation[], edits: PageEdit[]): MergeResult {
  if (edits.length === 0) return { ok: false, error: "pages is required" };
  if (current.length === 0) return { ok: false, error: "This order has no pages to edit" };

  const seen = new Set<string>();
  const byKey = new Map(current.map((page) => [`${page.documentId}:${page.pageNumber}`, page]));
  const replacements = new Map<string, string[]>();

  for (const edit of edits) {
    const key = `${edit.documentId}:${edit.pageNumber}`;
    if (seen.has(key)) return { ok: false, error: "Each page can be edited once" };
    seen.add(key);
    const page = byKey.get(key);
    if (!page) return { ok: false, error: "Unknown document page" };
    const paragraphs = cleanParagraphs(edit.paragraphs);
    if (!paragraphs) return { ok: false, error: "Each edited page needs translation text" };
    replacements.set(key, paragraphs);
  }

  const pages: MergedRenderPage[] = [];
  for (const page of [...current].sort((a, b) => a.combinedPageNumber - b.combinedPageNumber)) {
    const key = `${page.documentId}:${page.pageNumber}`;
    const paragraphs = replacements.get(key) ?? cleanParagraphs(page.paragraphs);
    if (!paragraphs) return { ok: false, error: "Every page needs translation text before the files can be regenerated" };
    pages.push({
      combinedPageNumber: page.combinedPageNumber,
      widthPt: page.widthPt && page.widthPt > 0 ? page.widthPt : LETTER_WIDTH_PT,
      heightPt: page.heightPt && page.heightPt > 0 ? page.heightPt : LETTER_HEIGHT_PT,
      paragraphs,
    });
  }

  return { ok: true, pages, edited: edits.length };
}
