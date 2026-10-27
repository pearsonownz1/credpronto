import { editorPagesFromTranslations, outputsAfterEdit, sanitizeEditorPages, type GcsEditorPage } from "@/lib/gcs/editor-pages";
import { HttpError } from "@/lib/orders/errors";
import { gcsCoverClientName, isGcsOrder } from "@/lib/orders/gcs";
import {
  getOrderById,
  latestReadyPreview,
  listConfirmations,
  listDocuments,
  listPages,
  listTranslations,
  requireOrderByHash,
  updateTranslationOutput,
  withCombinedNumbers,
  type Db,
} from "@/lib/orders/db";
import { FINALS_BUCKET, PREVIEW_URL_SECONDS, PREVIEWS_BUCKET } from "@/lib/orders/constants";
import { renderCertifiedTranslationPdf } from "@/lib/orders/pdf/render";
import { blocksToParagraphs } from "@/lib/orders/pdf/structure";
import { signedObjectUrl, uploadObject } from "@/lib/orders/storage";
import { assertOrderTokenShape, hashOrderToken, isOrderId } from "@/lib/orders/token";

export type SavedGcsTranslation = {
  translatedPdfUrl: string;
  pages: GcsEditorPage[];
};

async function requireGcsOrder(db: Db, orderKey: string) {
  const order = isOrderId(orderKey)
    ? await getOrderById(db, orderKey)
    : await (async () => {
        assertOrderTokenShape(orderKey);
        return requireOrderByHash(db, hashOrderToken(orderKey));
      })();
  if (!order || !isGcsOrder(order)) throw new HttpError("Order not found", 404);
  return order;
}

export async function readGcsEditorPages(db: Db, orderKey: string): Promise<GcsEditorPage[]> {
  const order = await requireGcsOrder(db, orderKey);
  const documents = await listDocuments(db, order.id);
  const documentIds = documents.map((document) => document.id);
  const [translations, sourcePages] = await Promise.all([
    listTranslations(db, documentIds),
    listPages(db, documentIds),
  ]);
  const numbered = withCombinedNumbers(documents, sourcePages);
  return editorPagesFromTranslations({
    translations,
    sourcePages: numbered.map((page) => ({
      documentId: page.documentId,
      pageNumber: page.pageNumber,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      combinedPageNumber: page.number,
    })),
  });
}

export async function saveGcsTranslation(db: Db, orderKey: string, pages: unknown): Promise<SavedGcsTranslation> {
  const edited = sanitizeEditorPages(pages);
  if (!edited) throw new HttpError("pages is required", 400);
  const order = await requireGcsOrder(db, orderKey);
  const documents = await listDocuments(db, order.id);
  const documentIds = documents.map((document) => document.id);
  const [translations, sourcePages, confirmations, preview] = await Promise.all([
    listTranslations(db, documentIds),
    listPages(db, documentIds),
    listConfirmations(db, order.id),
    latestReadyPreview(db, order.id),
  ]);
  if (translations.length === 0) throw new HttpError("This translation is not ready to edit", 409);
  const updates = outputsAfterEdit(translations, edited);
  if (updates.length === 0) throw new HttpError("This translation is not ready to edit", 409);
  await Promise.all(updates.map((update) => updateTranslationOutput(db, update.id, update.output)));

  const numbered = withCombinedNumbers(documents, sourcePages);
  const saved = editorPagesFromTranslations({
    translations: translations.map((translation) => {
      const update = updates.find((item) => item.id === translation.id);
      return update ? { ...translation, output: update.output } : translation;
    }),
    sourcePages: numbered.map((page) => ({
      documentId: page.documentId,
      pageNumber: page.pageNumber,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      combinedPageNumber: page.number,
    })),
  });
  const renderPages = [...saved].sort((a, b) => a.combinedPageNumber - b.combinedPageNumber);
  const bytes = await renderCertifiedTranslationPdf({
    letterhead: "gcs",
    watermark: false,
    orderId: order.id,
    sourceLanguage: order.sourceLanguage || "und",
    targetLanguage: order.targetLanguage,
    date: new Date().toISOString().slice(0, 10),
    clientName: gcsCoverClientName(confirmations),
    pricedPages: order.billablePages,
    degreeCount: order.degreeCount,
    documents: documents.map((document) => ({
      name: document.filename,
      sourcePages: numbered.filter((page) => page.documentId === document.id).length,
      translatedPages: renderPages.filter((page) => page.documentId === document.id).length,
    })),
    pages: renderPages.map((page) => ({
      combinedPageNumber: page.combinedPageNumber,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      paragraphs: blocksToParagraphs(page.blocks),
      blocks: page.blocks,
      ...(page.kind ? { kind: page.kind } : {}),
    })),
  });

  const stablePath = `${order.id}/certified-translation.pdf`;
  const paths = new Set<string>([stablePath]);
  if (order.finalTranslationPath) paths.add(order.finalTranslationPath);
  if (order.certificationPath) paths.add(order.certificationPath);
  await Promise.all(
    [...paths].map((path) => uploadObject(db, FINALS_BUCKET, path, bytes, "application/pdf")),
  );
  if (preview?.previewPath) {
    await uploadObject(db, PREVIEWS_BUCKET, preview.previewPath, bytes, "application/pdf");
  }
  const translatedPdfUrl = await signedObjectUrl(db, FINALS_BUCKET, stablePath, PREVIEW_URL_SECONDS);
  return { translatedPdfUrl, pages: saved.length > 0 ? saved : edited };
}
