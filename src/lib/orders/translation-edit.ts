import { sanitizeEditorBlock } from "@/lib/gcs/editor-pages";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "./constants";
import { pageKind, type PageKind, type RenderBlock } from "./pdf/layout";

export type PageTranslation = {
  documentId: string;
  pageNumber: number;
  combinedPageNumber: number;
  widthPt: number | null;
  heightPt: number | null;
  paragraphs: string[];
  /** Present only when the stored translation row has structured blocks. */
  blocks?: RenderBlock[];
  kind?: PageKind | null;
};

export type PageEdit = {
  documentId: string;
  pageNumber: number;
  paragraphs: string[];
  /** Set when the block editor saved this page. A line edit leaves this unset. */
  blocks?: RenderBlock[];
  /** `null` clears a stored kind. Omitted when the caller did not send one. */
  kind?: PageKind | null;
};

export type MergedRenderPage = {
  combinedPageNumber: number;
  widthPt: number;
  heightPt: number;
  paragraphs: string[];
  blocks?: RenderBlock[];
  kind?: PageKind | null;
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

function outputPageRecord(
  output: unknown,
  page: { pageNumber: number; combinedPageNumber?: number },
): Record<string, unknown> | null {
  if (!output || typeof output !== "object") return null;
  const pages = (output as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return null;
  const records = pages.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  return (
    records.find((record) => record.pageNumber === page.pageNumber) ??
    records.find(
      (record) => page.combinedPageNumber != null && record.combinedPageNumber === page.combinedPageNumber,
    ) ??
    null
  );
}

/** Blocks and kind actually stored on a translation page. Paragraph-only rows stay unstructured. */
export function storedPageLayout(
  output: unknown,
  page: { pageNumber: number; combinedPageNumber?: number },
): { blocks?: RenderBlock[]; kind: PageKind | null } {
  const record = outputPageRecord(output, page);
  if (!record) return { kind: null };
  const kind = pageKind(record.kind) ?? null;
  if (!Array.isArray(record.blocks)) return { kind };
  const blocks = record.blocks.flatMap((block) => {
    const sanitized = sanitizeEditorBlock(block);
    return sanitized ? [sanitized] : [];
  });
  return blocks.length > 0 ? { blocks, kind } : { kind };
}

export function paragraphsForPage(
  output: unknown,
  page: { pageNumber: number; combinedPageNumber?: number },
): string[] | null {
  const match = outputPageRecord(output, page);
  if (!match) return null;
  const paragraphs = match.paragraphs;
  if (!Array.isArray(paragraphs)) return null;
  const text = paragraphs.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      return [(item as { text: string }).text];
    }
    return [];
  });
  return text.length > 0 ? text : null;
}

/** Paragraph values as stored, including `{ text, source_index }` segments. */
export function storedParagraphsForPage(
  output: unknown,
  page: { pageNumber: number; combinedPageNumber?: number },
): unknown[] {
  const match = outputPageRecord(output, page);
  const paragraphs = match ? match.paragraphs : null;
  return Array.isArray(paragraphs) ? paragraphs : [];
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
  const replacements = new Map<string, PageEdit>();

  for (const edit of edits) {
    const key = `${edit.documentId}:${edit.pageNumber}`;
    if (seen.has(key)) return { ok: false, error: "Each page can be edited once" };
    seen.add(key);
    const page = byKey.get(key);
    if (!page) return { ok: false, error: "Unknown document page" };
    const paragraphs = cleanParagraphs(edit.paragraphs);
    if (!paragraphs) return { ok: false, error: "Each edited page needs translation text" };
    replacements.set(key, { ...edit, paragraphs });
  }

  const pages: MergedRenderPage[] = [];
  for (const page of [...current].sort((a, b) => a.combinedPageNumber - b.combinedPageNumber)) {
    const key = `${page.documentId}:${page.pageNumber}`;
    const edit = replacements.get(key);
    const paragraphs = edit?.paragraphs ?? cleanParagraphs(page.paragraphs);
    if (!paragraphs) return { ok: false, error: "Every page needs translation text before the files can be regenerated" };
    // A line edit replaces paragraphs and drops that page's blocks so the new text is what renders.
    // An unedited page keeps the blocks already stored on the translation.
    const blocks = edit ? edit.blocks : page.blocks;
    const keptBlocks = blocks && blocks.length > 0 ? blocks : undefined;
    const kind = edit && edit.kind !== undefined ? edit.kind : page.kind ?? null;
    pages.push({
      combinedPageNumber: page.combinedPageNumber,
      widthPt: page.widthPt && page.widthPt > 0 ? page.widthPt : LETTER_WIDTH_PT,
      heightPt: page.heightPt && page.heightPt > 0 ? page.heightPt : LETTER_HEIGHT_PT,
      paragraphs,
      ...(keptBlocks ? { blocks: keptBlocks } : {}),
      ...(kind ? { kind } : {}),
    });
  }

  return { ok: true, pages, edited: edits.length };
}
