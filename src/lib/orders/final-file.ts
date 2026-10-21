import { FINALS_BUCKET, ORIGINALS_BUCKET } from "./constants";
import { listDocuments, listPages, listTranslations, type Db } from "./db";
import { deliveryDocumentName, detectDocumentTitle, orderDownloadFilename } from "./download-name";
import { inReadingOrder } from "./page-order";
import { buildCombinedOriginal, type SourceFile } from "./pdf/combine";
import { appendPdf, concatPdfs, mergeCertifiedPacket } from "./pdf/merge";
import { pdfPageCount, stampPacketPageNumbers } from "./pdf/page-numbers";
import { downloadObject, uploadObject } from "./storage";
import type { DocumentRecord, OrderRecord } from "./types";

const PDF_TYPE = "application/pdf";

/** One object in the private finals bucket. Both order columns point at it. */
export function certifiedTranslationObjectPath(orderId: string, version: number): string {
  return `${orderId}/certified-translation-v${version}.pdf`;
}

const CERTIFIED_TRANSLATION_OBJECT = /\/certified-translation-v\d+\.pdf$/;

/** The clean translation packet, not an evaluation report stored in the same column. */
export function isCertifiedTranslationPath(path: string | null | undefined): path is string {
  return typeof path === "string" && CERTIFIED_TRANSLATION_OBJECT.test(path);
}

/**
 * A paid bundle can download that packet while the evaluation is still in review.
 * An unpaid order keeps the file private, even after the preview has been built.
 */
export function bundleTranslationReady(order: {
  includeTranslation?: boolean | null;
  status?: string | null;
  paymentStatus?: string | null;
  finalTranslationPath?: string | null;
}): boolean {
  if (order.includeTranslation !== true || !isCertifiedTranslationPath(order.finalTranslationPath)) return false;
  return (
    order.status === "paid" ||
    order.status === "approved" ||
    order.status === "delivered" ||
    order.paymentStatus === "paid" ||
    order.paymentStatus === "paid_test"
  );
}

/**
 * Cover and translation are already one PDF. Append the original pages when
 * they can be read. A missing original still stores the certified translation.
 */
export async function storeCertifiedTranslation(
  db: Db,
  input: {
    orderId: string;
    version: number;
    cleanTranslation: Uint8Array;
    combinedOriginalPath: string | null;
  },
): Promise<string> {
  const documents = inReadingOrder(await listDocuments(db, input.orderId));
  const original = await loadOriginalPdf(db, {
    combinedOriginalPath: input.combinedOriginalPath,
    documents,
  });
  const footerPages = original ? await pdfPageCount(input.cleanTranslation) : 0;
  const bytes = original
    ? await stampPacketPageNumbers(await appendPdf(input.cleanTranslation, original), {
        orderId: input.orderId,
        footerPages,
      })
    : input.cleanTranslation;
  const path = certifiedTranslationObjectPath(input.orderId, input.version);
  await uploadObject(db, FINALS_BUCKET, path, bytes, PDF_TYPE);
  return path;
}

export async function resolveCustomerFinal(
  db: Db,
  order: OrderRecord,
  delivery: { finalPath: string | null; certificationPath: string | null },
): Promise<{ path: string; filename: string } | null> {
  const documents = inReadingOrder(await listDocuments(db, order.id));
  const names = documents.map((document) => document.filename);
  const evaluation = order.service != null;
  const filename = evaluation
    ? orderDownloadFilename("evaluation", names, order.targetLanguage)
    : deliveryDocumentName({
        detectedTitle: await detectedTitle(db, documents),
        documentNames: names,
      }).filename;

  const finalPath = delivery.finalPath;
  const certPath = delivery.certificationPath;
  const path = finalPath || certPath;
  if (!path) return null;
  if (!finalPath || !certPath || finalPath === certPath) return { path, filename };

  try {
    const [main, certification] = await Promise.all([
      downloadObject(db, FINALS_BUCKET, finalPath),
      downloadObject(db, FINALS_BUCKET, certPath),
    ]);
    const merged = evaluation
      ? await concatPdfs([certification, main])
      : await mergeCertifiedPacket({
          certification,
          translation: main,
          original: await loadOriginalPdf(db, {
            combinedOriginalPath: order.combinedOriginalPath,
            documents,
          }),
          orderId: order.id,
        });
    const stored = `${order.id}/${evaluation ? "evaluation-merged.pdf" : "certified-translation.pdf"}`;
    await uploadObject(db, FINALS_BUCKET, stored, merged, PDF_TYPE);
    return { path: stored, filename };
  } catch (error) {
    console.error(error instanceof Error ? error.message : "final merge failed");
    return { path, filename };
  }
}

async function detectedTitle(db: Db, documents: DocumentRecord[]): Promise<string | null> {
  const [pages, translations] = await Promise.all([
    listPages(
      db,
      documents.map((document) => document.id),
    ),
    listTranslations(
      db,
      documents.map((document) => document.id),
    ),
  ]);
  return detectDocumentTitle({
    outputs: translations.map((translation) => translation.output),
    ocrTexts: pages.map((page) => page.ocrText),
  });
}

function storageReady(db: Db): boolean {
  const storage = (db as { storage?: { from?: unknown } }).storage;
  return typeof storage?.from === "function";
}

/** Combined original when it is stored, otherwise one PDF built from the uploads. */
export async function loadOriginalPdf(
  db: Db,
  input: { combinedOriginalPath: string | null; documents: DocumentRecord[] },
): Promise<Uint8Array | null> {
  if (!storageReady(db)) return null;
  if (input.combinedOriginalPath) {
    try {
      return await downloadObject(db, ORIGINALS_BUCKET, input.combinedOriginalPath);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "combined original unavailable");
    }
  }
  if (input.documents.length === 0) return null;
  try {
    const files: SourceFile[] = [];
    for (const document of input.documents) {
      const bytes = await downloadObject(db, ORIGINALS_BUCKET, document.originalPath);
      files.push({ bytes, mime: document.mime || PDF_TYPE });
    }
    return (await buildCombinedOriginal(files)).pdf;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "original pages unavailable");
    return null;
  }
}
