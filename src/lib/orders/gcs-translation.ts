import { isGcsPinUnlocked } from "@/lib/gcs/pin";
import { ORIGINALS_BUCKET } from "./constants";
import {
  ensurePendingDelivery,
  getDelivery,
  insertEvent,
  insertPreview,
  insertTranslation,
  listConfirmations,
  listDocuments,
  listPages,
  listTranslations,
  markPreview,
  nextPreviewVersion,
  nextTranslationVersion,
  updateDelivery,
  updateOrder,
  withCombinedNumbers,
  type Db,
} from "./db";
import { HttpError } from "./errors";
import { gcsCoverClientName, isGcsOrder } from "./gcs";
import { orderForToken } from "./order-access";
import { coverDocuments } from "./pdf/cover";
import { pageKind, type PageKind, type RenderBlock, type RenderPage } from "./pdf/layout";
import { cropHolderPhoto } from "./pdf/photo";
import { renderOrderPdfs } from "./pdf/render";
import { blocksToParagraphs, finalizeBlocks, structurePage } from "./pdf/structure";
import { storeCertifiedTranslation } from "./final-file";
import { paragraphsForPage } from "./translation-edit";
import { downloadObject, uploadObject } from "./storage";
import type { OrderRecord, PageRecord } from "./types";

export type GcsTranslationPage = {
  documentId: string;
  pageNumber: number;
  combinedPageNumber: number;
  filename: string;
  paragraphs: string[];
  text: string;
};

type StoredPage = {
  pageNumber?: unknown;
  combinedPageNumber?: unknown;
  paragraphs?: unknown;
  blocks?: unknown;
  kind?: unknown;
};

type NumberedPage = PageRecord & { number: number };

export async function requireGcsTranslationOrder(request: Request, token: string) {
  if (!isGcsPinUnlocked(request)) {
    throw new HttpError("Enter the GCS PIN to start a translation.", 401);
  }
  const { db, order } = await orderForToken(token);
  if (!isGcsOrder(order)) throw new HttpError("Translation editing is not available for this order", 403);
  return { db, order, token };
}

export async function readGcsTranslation(db: Db, order: OrderRecord): Promise<{ pages: GcsTranslationPage[] }> {
  const { documents, pages, latest } = await loadOrderPages(db, order.id);
  const names = new Map(documents.map((document) => [document.id, document.filename]));
  return {
    pages: pages.map((page) => {
      const stored = storedPage(latest.get(page.documentId)?.output, page);
      const paragraphs = pageParagraphs(stored, page.ocrText);
      return {
        documentId: page.documentId,
        pageNumber: page.pageNumber,
        combinedPageNumber: page.number,
        filename: names.get(page.documentId) ?? "Document",
        paragraphs,
        text: paragraphs.join("\n"),
      };
    }),
  };
}

export async function saveGcsTranslation(db: Db, order: OrderRecord, body: unknown): Promise<{ pages: GcsTranslationPage[] }> {
  const edits = parseGcsTranslationEdits(body);
  if (!order.sourceLanguage) throw new HttpError("Set a source language before editing the translation", 409);
  const { documents, pages, latest } = await loadOrderPages(db, order.id);
  if (pages.length === 0) throw new HttpError("This order has no pages to edit", 400);

  const replacements = new Map<string, string[]>();
  for (const edit of edits) {
    const page = matchPage(pages, edit);
    if (!page) throw new HttpError("Unknown document page", 400);
    const key = pageKey(page);
    if (replacements.has(key)) throw new HttpError("Each page can be edited once", 400);
    replacements.set(key, edit.paragraphs);
  }

  const rendered: RenderPage[] = [];
  const storedOutput = new Map<string, { paragraphs: unknown; blocks?: RenderBlock[]; kind?: PageKind }>();
  for (const page of pages) {
    const key = pageKey(page);
    const stored = storedPage(latest.get(page.documentId)?.output, page);
    const current = pageParagraphs(stored, page.ocrText);
    const submitted = replacements.get(key);
    const edited = submitted != null && !sameLines(submitted, current);
    const paragraphs = edited && submitted ? submitted : current;
    if (!paragraphs.some((paragraph) => paragraph.trim())) {
      throw new HttpError("Every page needs translation text before the files can be regenerated", 400);
    }
    const blocks = edited ? structurePage(paragraphs.join("\n")) : storedBlocks(stored);
    const kind = edited ? undefined : stored?.kind;
    storedOutput.set(key, {
      paragraphs: edited ? paragraphs : stored?.paragraphs ?? paragraphs,
      ...(blocks.length > 0 ? { blocks } : {}),
      ...(kind ? { kind } : {}),
    });
    const photoPng = await holderPhoto(
      db,
      documents.find((document) => document.id === page.documentId),
      blocks,
    );
    rendered.push({
      combinedPageNumber: page.number,
      widthPt: page.widthPt && page.widthPt > 0 ? page.widthPt : 612,
      heightPt: page.heightPt && page.heightPt > 0 ? page.heightPt : 792,
      paragraphs,
      ...(blocks.length > 0 ? { blocks } : {}),
      ...(kind ? { kind } : {}),
      ...(photoPng ? { photoPng } : {}),
    });
  }

  const documentIds = documents.map((document) => document.id);
  const version = Math.max(await nextPreviewVersion(db, order.id), await nextTranslationVersion(db, documentIds));
  const previewPath = `${order.id}/preview-v${version}.pdf`;
  const inserted = await insertPreview(db, { orderId: order.id, version, previewPath });
  if (inserted === "exists") throw new HttpError("That preview version already exists", 409);

  try {
    for (const document of documents) {
      const documentPages = pages.filter((page) => page.documentId === document.id);
      await insertTranslation(db, {
        documentId: document.id,
        version,
        model: "gcs-edit",
        status: "ready",
        output: {
          pages: documentPages.map((page) => {
            const saved = storedOutput.get(pageKey(page));
            return {
              pageNumber: page.pageNumber,
              combinedPageNumber: page.number,
              paragraphs: saved?.paragraphs ?? [],
              ...(saved?.blocks ? { blocks: saved.blocks } : {}),
              ...(saved?.kind ? { kind: saved.kind } : {}),
            };
          }),
        },
      });
    }

    const translatedCounts = new Map<string, number>();
    const translatedText = new Map<string, string>();
    for (const page of rendered) {
      const source = pages.find((item) => item.number === page.combinedPageNumber);
      if (!source) continue;
      translatedCounts.set(source.documentId, (translatedCounts.get(source.documentId) ?? 0) + 1);
      const prior = translatedText.get(source.documentId);
      translatedText.set(source.documentId, prior ? `${prior}\n${page.paragraphs.join("\n")}` : page.paragraphs.join("\n"));
    }
    const confirmations = await listConfirmations(db, order.id);
    const files = await renderOrderPdfs({
      orderId: order.id,
      sourceLanguage: order.sourceLanguage,
      targetLanguage: order.targetLanguage,
      date: new Date().toISOString().slice(0, 10),
      pages: rendered,
      brand: "gcs",
      clientName: gcsCoverClientName(confirmations),
      documents: coverDocuments(documents, pages, translatedCounts, translatedText),
      pricedPages: order.billablePages,
      degreeCount: order.degreeCount,
    });
    const translationPath = await storeCertifiedTranslation(db, {
      orderId: order.id,
      version,
      cleanTranslation: files.cleanTranslation,
      combinedOriginalPath: order.combinedOriginalPath,
      appendOriginal: false,
      stampVerification: false,
    });
    await uploadObject(db, "previews", previewPath, files.watermarkedPreview, "application/pdf");
    await markPreview(db, order.id, version, "ready");
    await updateOrder(db, order.id, {
      final_translation_path: translationPath,
      certification_path: translationPath,
    });
    if (!(await getDelivery(db, order.id))) await ensurePendingDelivery(db, order.id);
    await updateDelivery(db, order.id, {
      final_path: translationPath,
      certification_path: translationPath,
    });
    await insertEvent(db, order.id, "translation_edited", { version, model: "gcs-edit" });
    return readGcsTranslation(db, order);
  } catch (error) {
    await markPreview(db, order.id, version, "failed");
    throw error;
  }
}

function parseGcsTranslationEdits(body: unknown): Array<{
  documentId?: string;
  pageNumber?: number;
  combinedPageNumber?: number;
  paragraphs: string[];
}> {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const pages = (body as { pages?: unknown }).pages;
  if (!Array.isArray(pages) || pages.length === 0) throw new HttpError("pages is required", 400);
  return pages.map((entry) => {
    if (!entry || typeof entry !== "object") throw new HttpError("Invalid page edit", 400);
    const page = entry as {
      documentId?: unknown;
      pageNumber?: unknown;
      combinedPageNumber?: unknown;
      text?: unknown;
      paragraphs?: unknown;
    };
    const documentId = typeof page.documentId === "string" && page.documentId.trim() ? page.documentId : undefined;
    const pageNumber = integerPage(page.pageNumber);
    const combinedPageNumber = integerPage(page.combinedPageNumber);
    if (!documentId && pageNumber == null && combinedPageNumber == null) {
      throw new HttpError("Each page needs a documentId, pageNumber, or combinedPageNumber", 400);
    }
    const paragraphs = editParagraphs(page.paragraphs, page.text);
    if (!paragraphs) throw new HttpError("Each edited page needs translation text", 400);
    return { documentId, pageNumber, combinedPageNumber, paragraphs };
  });
}

function integerPage(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError("pageNumber must be an integer starting at 1", 400);
  }
  return value;
}

function editParagraphs(paragraphs: unknown, text: unknown): string[] | null {
  if (Array.isArray(paragraphs) && paragraphs.every((paragraph) => typeof paragraph === "string")) {
    const cleaned = paragraphs.map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0);
    if (cleaned.length > 0) return cleaned;
  }
  if (typeof text === "string") {
    const cleaned = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}

async function loadOrderPages(db: Db, orderId: string) {
  const documents = await listDocuments(db, orderId);
  const pages = withCombinedNumbers(
    documents,
    await listPages(db, documents.map((document) => document.id)),
  );
  const translations = await listTranslations(db, documents.map((document) => document.id));
  const latest = new Map<string, (typeof translations)[number]>();
  for (const translation of translations) {
    if (translation.status !== "ready") continue;
    const current = latest.get(translation.documentId);
    if (!current || translation.version > current.version) latest.set(translation.documentId, translation);
  }
  return { documents, pages, latest };
}

function sameLines(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((line, index) => line.trim() === (right[index] ?? "").trim());
}

function pageKey(page: { documentId: string; pageNumber: number }): string {
  return `${page.documentId}:${page.pageNumber}`;
}

function matchPage(
  pages: NumberedPage[],
  edit: { documentId?: string; pageNumber?: number; combinedPageNumber?: number },
): NumberedPage | null {
  if (edit.documentId && edit.pageNumber != null) {
    return pages.find((page) => page.documentId === edit.documentId && page.pageNumber === edit.pageNumber) ?? null;
  }
  if (edit.combinedPageNumber != null) {
    const found = pages.filter((page) => page.number === edit.combinedPageNumber);
    return found.length === 1 ? found[0] ?? null : null;
  }
  if (edit.documentId && edit.pageNumber == null) {
    const found = pages.filter((page) => page.documentId === edit.documentId);
    return found.length === 1 ? found[0] ?? null : null;
  }
  if (edit.pageNumber != null) {
    const found = pages.filter((page) => page.pageNumber === edit.pageNumber);
    return found.length === 1 ? found[0] ?? null : null;
  }
  return null;
}

function outputPages(output: unknown): StoredPage[] {
  if (!output || typeof output !== "object") return [];
  const pages = (output as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  return pages.filter((entry): entry is StoredPage => Boolean(entry) && typeof entry === "object");
}

function storedPage(
  output: unknown,
  page: { pageNumber: number; number: number },
): (Omit<StoredPage, "kind"> & { kind?: PageKind }) | null {
  const records = outputPages(output);
  const match =
    records.find((record) => record.pageNumber === page.pageNumber) ??
    records.find((record) => record.combinedPageNumber === page.number);
  if (!match) return null;
  return { ...match, kind: pageKind(match.kind) };
}

function storedBlocks(stored: StoredPage | null): RenderBlock[] {
  if (!stored || !Array.isArray(stored.blocks) || stored.blocks.length === 0) return [];
  return finalizeBlocks(stored.blocks as RenderBlock[]);
}

function pageParagraphs(stored: StoredPage | null, ocrText: string | null): string[] {
  const translated = stored ? paragraphsForPage(wrapOutput(stored), { pageNumber: numberOf(stored.pageNumber), combinedPageNumber: numberOf(stored.combinedPageNumber) }) : null;
  if (translated && translated.some((paragraph) => paragraph.trim())) return translated;
  const fromBlocks = storedBlocks(stored);
  if (fromBlocks.length > 0) {
    const lines = blocksToParagraphs(fromBlocks).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) return lines;
  }
  return (ocrText ?? "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function wrapOutput(stored: StoredPage): unknown {
  return { pages: [stored] };
}

function numberOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

async function holderPhoto(
  db: Db,
  document: { mime: string | null; originalPath: string } | undefined,
  blocks: RenderBlock[],
): Promise<Uint8Array | null> {
  if (!document || !blocks.some((block) => block.type === "photo")) return null;
  if (!document.mime?.startsWith("image/") || !document.originalPath) return null;
  try {
    const bytes = await downloadObject(db, ORIGINALS_BUCKET, document.originalPath);
    return await cropHolderPhoto(bytes);
  } catch {
    return null;
  }
}
